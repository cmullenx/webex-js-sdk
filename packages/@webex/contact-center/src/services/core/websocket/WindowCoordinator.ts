import LoggerProxy from '../../../logger-proxy';
import {WindowCoordinatorMessage, WindowCoordinatorMessageType} from './types';

/**
 * Name of the BroadcastChannel used for cross-window coordination.
 * @ignore
 */
const CHANNEL_NAME = 'webex-cc-sdk-window-coordinator';

/**
 * Duration in milliseconds after which a window is considered stale if no heartbeat is received.
 * @ignore
 */
const HEARTBEAT_STALE_THRESHOLD = 15000;

/**
 * Interval in milliseconds at which heartbeat messages are sent.
 * @ignore
 */
const HEARTBEAT_INTERVAL = 5000;

/**
 * File name constant for logging.
 * @ignore
 */
const WINDOW_COORDINATOR_FILE = 'WindowCoordinator';

/**
 * Coordinates multiple browser windows/tabs sharing the same CC SDK agent session.
 *
 * Uses the BroadcastChannel API to track which windows are alive.
 * When a window is closing, it can check whether other windows still exist
 * before allowing the WebSocket to close — preventing the backend from
 * setting the agent to Idle due to a WebSocket disconnect.
 *
 * @ignore
 */
export default class WindowCoordinator {
  private windowId: string;
  private channel: BroadcastChannel | null = null;
  private peerWindows: Map<string, number> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pagehideHandler: (() => void) | null = null;

  constructor() {
    this.windowId = WindowCoordinator.generateWindowId();
  }

  /**
   * Starts coordinating with other windows. Opens the BroadcastChannel,
   * announces this window, and begins sending heartbeats.
   * @public
   */
  public start(): void {
    if (typeof BroadcastChannel === 'undefined') {
      LoggerProxy.info('BroadcastChannel not available, multi-window coordination disabled', {
        module: WINDOW_COORDINATOR_FILE,
        method: 'start',
      });

      return;
    }

    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<WindowCoordinatorMessage>) => {
        this.handleMessage(event.data);
      };

      this.broadcast({
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: this.windowId,
        timestamp: Date.now(),
      });

      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
        this.pruneStaleWindows();
      }, HEARTBEAT_INTERVAL);

      this.pagehideHandler = () => {
        this.broadcast({
          type: WindowCoordinatorMessageType.UNREGISTER,
          windowId: this.windowId,
          timestamp: Date.now(),
        });
      };
      window.addEventListener('pagehide', this.pagehideHandler);

      LoggerProxy.info(`Window coordinator started for windowId: ${this.windowId}`, {
        module: WINDOW_COORDINATOR_FILE,
        method: 'start',
      });
    } catch (error) {
      LoggerProxy.error(`Failed to start window coordinator: ${error}`, {
        module: WINDOW_COORDINATOR_FILE,
        method: 'start',
      });
    }
  }

  /**
   * Stops the coordinator, cleans up the BroadcastChannel, timers, and event listeners.
   * @public
   */
  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.pagehideHandler) {
      window.removeEventListener('pagehide', this.pagehideHandler);
      this.pagehideHandler = null;
    }

    if (this.channel) {
      this.broadcast({
        type: WindowCoordinatorMessageType.UNREGISTER,
        windowId: this.windowId,
        timestamp: Date.now(),
      });
      this.channel.close();
      this.channel = null;
    }

    this.peerWindows.clear();

    LoggerProxy.info(`Window coordinator stopped for windowId: ${this.windowId}`, {
      module: WINDOW_COORDINATOR_FILE,
      method: 'stop',
    });
  }

  /**
   * Returns true if there are other known active windows/tabs besides this one.
   * @public
   * @returns {boolean} Whether other active windows exist.
   */
  public hasOtherActiveWindows(): boolean {
    this.pruneStaleWindows();

    return this.peerWindows.size > 0;
  }

  /**
   * Returns the unique ID assigned to this window.
   * @public
   * @returns {string} The window's unique ID.
   */
  public getWindowId(): string {
    return this.windowId;
  }

  /**
   * Returns the count of known active peer windows (excluding this window).
   * @public
   * @returns {number} Number of active peer windows.
   */
  public getActiveWindowCount(): number {
    this.pruneStaleWindows();

    return this.peerWindows.size;
  }

  /**
   * Handles incoming BroadcastChannel messages from other windows.
   * @private
   */
  private handleMessage(message: WindowCoordinatorMessage): void {
    if (message.windowId === this.windowId) {
      return;
    }

    switch (message.type) {
      case WindowCoordinatorMessageType.REGISTER:
        this.peerWindows.set(message.windowId, message.timestamp);
        this.broadcast({
          type: WindowCoordinatorMessageType.ANNOUNCE,
          windowId: this.windowId,
          timestamp: Date.now(),
        });
        LoggerProxy.info(
          `Peer window registered: ${message.windowId}, total peers: ${this.peerWindows.size}`,
          {
            module: WINDOW_COORDINATOR_FILE,
            method: 'handleMessage',
          }
        );
        break;

      case WindowCoordinatorMessageType.ANNOUNCE:
        this.peerWindows.set(message.windowId, message.timestamp);
        break;

      case WindowCoordinatorMessageType.HEARTBEAT:
        this.peerWindows.set(message.windowId, message.timestamp);
        break;

      case WindowCoordinatorMessageType.UNREGISTER:
        this.peerWindows.delete(message.windowId);
        LoggerProxy.info(
          `Peer window unregistered: ${message.windowId}, total peers: ${this.peerWindows.size}`,
          {
            module: WINDOW_COORDINATOR_FILE,
            method: 'handleMessage',
          }
        );
        break;

      default:
        break;
    }
  }

  /**
   * Sends a message to all other windows via the BroadcastChannel.
   * @private
   */
  private broadcast(message: WindowCoordinatorMessage): void {
    if (this.channel) {
      try {
        this.channel.postMessage(message);
      } catch (error) {
        LoggerProxy.error(`Failed to broadcast message: ${error}`, {
          module: WINDOW_COORDINATOR_FILE,
          method: 'broadcast',
        });
      }
    }
  }

  /**
   * Sends a periodic heartbeat to indicate this window is still alive.
   * @private
   */
  private sendHeartbeat(): void {
    this.broadcast({
      type: WindowCoordinatorMessageType.HEARTBEAT,
      windowId: this.windowId,
      timestamp: Date.now(),
    });
  }

  /**
   * Removes windows that have not sent a heartbeat within the stale threshold.
   * @private
   */
  private pruneStaleWindows(): void {
    const now = Date.now();

    this.peerWindows.forEach((lastSeen, windowId) => {
      if (now - lastSeen > HEARTBEAT_STALE_THRESHOLD) {
        this.peerWindows.delete(windowId);
        LoggerProxy.info(`Pruned stale peer window: ${windowId}`, {
          module: WINDOW_COORDINATOR_FILE,
          method: 'pruneStaleWindows',
        });
      }
    });
  }

  /**
   * Generates a unique window ID using crypto.randomUUID when available, with a fallback.
   * @private
   * @returns {string} A unique identifier for this window.
   */
  private static generateWindowId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    // Fallback for environments without crypto.randomUUID
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
