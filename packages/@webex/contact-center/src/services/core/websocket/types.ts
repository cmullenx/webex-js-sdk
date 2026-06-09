import {SubscribeRequest} from '../../../types';
import {WebSocketManager} from './WebSocketManager';

/**
 * Options for initializing a connection service.
 * @typedef ConnectionServiceOptions
 * @property {WebSocketManager} webSocketManager - The WebSocket manager instance.
 * @property {SubscribeRequest} subscribeRequest - The subscribe request payload.
 * @ignore
 */
export type ConnectionServiceOptions = {
  webSocketManager: WebSocketManager;
  subscribeRequest: SubscribeRequest;
};

/**
 * Details about the state of a lost connection and recovery attempts.
 * @typedef ConnectionLostDetails
 * @property {boolean} isConnectionLost - Indicates if the connection is currently lost.
 * @property {boolean} isRestoreFailed - Indicates if restoring the connection has failed.
 * @property {boolean} isSocketReconnected - Indicates if the socket has been reconnected.
 * @property {boolean} isKeepAlive - Indicates if the keep-alive mechanism is active.
 * @ignore
 */
export type ConnectionLostDetails = {
  isConnectionLost: boolean;
  isRestoreFailed: boolean;
  isSocketReconnected: boolean;
  isKeepAlive: boolean;
};

/**
 * Properties for connection configuration.
 * @typedef ConnectionProp
 * @property {number} lostConnectionRecoveryTimeout - Timeout in milliseconds for lost connection recovery.
 * @ignore
 */
export type ConnectionProp = {
  lostConnectionRecoveryTimeout: number;
};

/**
 * Message types exchanged between browser windows/tabs via the WindowCoordinator's BroadcastChannel.
 * @ignore
 */
export enum WindowCoordinatorMessageType {
  /** Sent when a new window registers itself */
  REGISTER = 'register',
  /** Sent when a window is closing and unregistering */
  UNREGISTER = 'unregister',
  /** Periodic heartbeat to confirm window is still alive */
  HEARTBEAT = 'heartbeat',
  /** Sent in response to a register message to announce presence */
  ANNOUNCE = 'announce',
}

/**
 * Shape of messages exchanged via the WindowCoordinator BroadcastChannel.
 * @ignore
 */
export type WindowCoordinatorMessage = {
  /** The type of coordination message */
  type: WindowCoordinatorMessageType;
  /** Unique identifier for the originating window */
  windowId: string;
  /** Timestamp when the message was sent */
  timestamp: number;
};
