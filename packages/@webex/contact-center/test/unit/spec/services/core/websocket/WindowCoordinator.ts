/* eslint-disable @typescript-eslint/no-explicit-any */
import 'jsdom-global/register';
import WindowCoordinator from '../../../../../../src/services/core/websocket/WindowCoordinator';
import {
  WindowCoordinatorMessageType,
  WindowCoordinatorMessage,
} from '../../../../../../src/services/core/websocket/types';
import LoggerProxy from '../../../../../../src/logger-proxy';

jest.mock('../../../../../../src/logger-proxy', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    initialize: jest.fn(),
  },
}));

describe('WindowCoordinator', () => {
  let coordinator: WindowCoordinator;
  let mockChannel: {
    postMessage: jest.Mock;
    close: jest.Mock;
    onmessage: ((event: MessageEvent<WindowCoordinatorMessage>) => void) | null;
  };
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockChannel = {
      postMessage: jest.fn(),
      close: jest.fn(),
      onmessage: null,
    };

    (global as any).BroadcastChannel = jest.fn(() => mockChannel);

    addEventListenerSpy = jest.spyOn(global.window, 'addEventListener');
    removeEventListenerSpy = jest.spyOn(global.window, 'removeEventListener');

    coordinator = new WindowCoordinator();
  });

  afterEach(() => {
    try {
      coordinator.stop();
    } catch {
      // stop() may fail if start() was never called; safe to ignore
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    delete (global as any).BroadcastChannel;
  });

  describe('start', () => {
    it('should create a BroadcastChannel and broadcast a register message', () => {
      coordinator.start();

      expect(global.BroadcastChannel).toHaveBeenCalledWith('webex-cc-sdk-window-coordinator');
      expect(mockChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WindowCoordinatorMessageType.REGISTER,
          windowId: expect.any(String),
          timestamp: expect.any(Number),
        })
      );
    });

    it('should register a pagehide event listener', () => {
      coordinator.start();

      expect(addEventListenerSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });

    it('should start sending heartbeats at interval', () => {
      coordinator.start();

      // Clear the initial register message
      mockChannel.postMessage.mockClear();

      // Advance past one heartbeat interval (5000ms)
      jest.advanceTimersByTime(5000);

      expect(mockChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WindowCoordinatorMessageType.HEARTBEAT,
        })
      );
    });

    it('should gracefully handle missing BroadcastChannel API', () => {
      delete (global as any).BroadcastChannel;

      coordinator.start();

      expect(LoggerProxy.info).toHaveBeenCalledWith(
        'BroadcastChannel not available, multi-window coordination disabled',
        expect.any(Object)
      );
    });

    it('should handle BroadcastChannel constructor errors', () => {
      (global as any).BroadcastChannel = jest.fn(() => {
        throw new Error('BroadcastChannel creation failed');
      });

      coordinator.start();

      expect(LoggerProxy.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start window coordinator'),
        expect.any(Object)
      );
    });
  });

  describe('stop', () => {
    it('should broadcast unregister, close channel, and remove event listener', () => {
      coordinator.start();
      mockChannel.postMessage.mockClear();

      coordinator.stop();

      expect(mockChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WindowCoordinatorMessageType.UNREGISTER,
        })
      );
      expect(mockChannel.close).toHaveBeenCalled();
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });

    it('should clear heartbeat timer', () => {
      coordinator.start();
      coordinator.stop();

      mockChannel.postMessage.mockClear();

      // Advance past heartbeat interval — should NOT send any more heartbeats
      jest.advanceTimersByTime(10000);

      expect(mockChannel.postMessage).not.toHaveBeenCalled();
    });

    it('should clear peer windows', () => {
      coordinator.start();

      // Simulate a peer registering
      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(true);

      coordinator.stop();

      expect(coordinator.hasOtherActiveWindows()).toBe(false);
    });
  });

  describe('hasOtherActiveWindows', () => {
    it('should return false when no peers are registered', () => {
      coordinator.start();

      expect(coordinator.hasOtherActiveWindows()).toBe(false);
    });

    it('should return true when a peer window is registered', () => {
      coordinator.start();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(true);
    });

    it('should return false after peer window unregisters', () => {
      coordinator.start();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(true);

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.UNREGISTER,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(false);
    });

    it('should return false when peer heartbeat has gone stale', () => {
      coordinator.start();

      const staleTimestamp = Date.now() - 20000; // 20s ago, exceeds 15s threshold
      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.HEARTBEAT,
        windowId: 'peer-1',
        timestamp: staleTimestamp,
      });

      // Advance time to make the peer stale
      jest.advanceTimersByTime(16000);

      expect(coordinator.hasOtherActiveWindows()).toBe(false);
    });
  });

  describe('getActiveWindowCount', () => {
    it('should return 0 when no peers exist', () => {
      coordinator.start();

      expect(coordinator.getActiveWindowCount()).toBe(0);
    });

    it('should return the correct count of active peers', () => {
      coordinator.start();
      const now = Date.now();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: now,
      });

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-2',
        timestamp: now,
      });

      expect(coordinator.getActiveWindowCount()).toBe(2);
    });
  });

  describe('message handling', () => {
    it('should ignore messages from own window', () => {
      coordinator.start();
      const ownWindowId = coordinator.getWindowId();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: ownWindowId,
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(false);
    });

    it('should respond to REGISTER with an ANNOUNCE message', () => {
      coordinator.start();
      mockChannel.postMessage.mockClear();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(mockChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WindowCoordinatorMessageType.ANNOUNCE,
        })
      );
    });

    it('should track peer from ANNOUNCE message', () => {
      coordinator.start();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.ANNOUNCE,
        windowId: 'peer-1',
        timestamp: Date.now(),
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(true);
    });

    it('should update peer timestamp on HEARTBEAT', () => {
      coordinator.start();
      const initialTimestamp = Date.now();

      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.REGISTER,
        windowId: 'peer-1',
        timestamp: initialTimestamp,
      });

      const updatedTimestamp = initialTimestamp + 5000;
      simulateIncomingMessage(mockChannel, {
        type: WindowCoordinatorMessageType.HEARTBEAT,
        windowId: 'peer-1',
        timestamp: updatedTimestamp,
      });

      expect(coordinator.hasOtherActiveWindows()).toBe(true);
    });
  });

  describe('pagehide handler', () => {
    it('should broadcast UNREGISTER on pagehide', () => {
      coordinator.start();
      mockChannel.postMessage.mockClear();

      // Get the pagehide handler and call it
      const pagehideCall = addEventListenerSpy.mock.calls.find(
        (call: unknown[]) => call[0] === 'pagehide'
      );

      expect(pagehideCall).toBeDefined();
      const handler = pagehideCall[1];
      handler();

      expect(mockChannel.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: WindowCoordinatorMessageType.UNREGISTER,
        })
      );
    });
  });

  describe('getWindowId', () => {
    it('should return a non-empty string', () => {
      expect(coordinator.getWindowId()).toBeTruthy();
      expect(typeof coordinator.getWindowId()).toBe('string');
    });

    it('should return a consistent ID for the same instance', () => {
      const id1 = coordinator.getWindowId();
      const id2 = coordinator.getWindowId();

      expect(id1).toBe(id2);
    });
  });
});

/**
 * Helper to simulate an incoming BroadcastChannel message.
 */
function simulateIncomingMessage(
  channel: {onmessage: ((event: MessageEvent<WindowCoordinatorMessage>) => void) | null},
  message: WindowCoordinatorMessage
): void {
  if (channel.onmessage) {
    channel.onmessage({data: message} as MessageEvent<WindowCoordinatorMessage>);
  }
}
