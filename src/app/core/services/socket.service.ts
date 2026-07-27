import { Injectable, OnDestroy, isDevMode } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import {
  BoardState,
  ClientToServerEvents,
  CursorEvent,
  CursorPayload,
  DrawActionAck,
  DrawEventPayload,
  ServerToClientEvents,
  WireDrawAction,
} from '../models/socket.types';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  private readonly _drawAction$ = new Subject<WireDrawAction>();
  private readonly _cursorMove$ = new Subject<CursorEvent>();
  private readonly _boardState$ = new Subject<BoardState>();
  private readonly _userJoined$ = new Subject<string>();
  private readonly _userLeft$ = new Subject<string>();

  readonly drawAction$ = this._drawAction$.asObservable();
  readonly cursorMove$ = this._cursorMove$.asObservable();
  readonly boardState$ = this._boardState$.asObservable();
  readonly userJoined$ = this._userJoined$.asObservable();
  readonly userLeft$ = this._userLeft$.asObservable();

  constructor() {
    const boardId = new URLSearchParams(window.location.search).get('boardId') ?? 'main';
    this.socket = io('http://localhost:3000', { transports: ['websocket'], query: { boardId } });

    if (isDevMode()) {
      (window as any).__e2e_socket = this.socket;
      (window as any).__e2e_connect_count = 0;
    }

    // Fires on initial connect AND after every reconnect — re-seed board state.
    this.socket.on('connect', () => {
      if (isDevMode()) {
        (window as any).__e2e_socket_connected = true;
        (window as any).__e2e_connect_count = ((window as any).__e2e_connect_count ?? 0) + 1;
      }
      this.joinBoard();
    });
    this.socket.on('disconnect', () => {
      if (isDevMode()) (window as any).__e2e_socket_connected = false;
    });

    this.socket.on('draw:action', (action) => {
      if (isDevMode()) (window as any).__e2e_last_draw_action = action;
      this._drawAction$.next(action);
    });
    this.socket.on('draw:cursor', (event) => this._cursorMove$.next(event));
    this.socket.on('board:state', (state) => this._boardState$.next(state));
    this.socket.on('user:joined', (userId) => this._userJoined$.next(userId));
    this.socket.on('user:left', (userId) => this._userLeft$.next(userId));
  }

  joinBoard(): void {
    if (this.socket.connected) {
      this.socket.emit('user:join');
    }
  }

  /** Emits a draw action and resolves with the server-assigned ack (seq number). */
  emitAction(payload: DrawEventPayload): Observable<DrawActionAck> {
    return new Observable((observer) => {
      this.socket.emit('draw:action', payload, (ack) => {
        observer.next(ack);
        observer.complete();
      });
    });
  }

  emitCursor(payload: CursorPayload): void {
    this.socket.emit('draw:cursor', payload);
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }
}
