import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';
import { BoardState, CursorEvent, DrawEventPayload, WireDrawAction } from './core/models/socket.types';
import { WhiteboardUser } from './core/models/user.model';
import { SocketService } from './core/services/socket.service';
import { App } from './app';

function makeCtxMock(): Partial<CanvasRenderingContext2D> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  return {
    canvas,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    ellipse: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: 'round',
    lineJoin: 'round',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  } as unknown as Partial<CanvasRenderingContext2D>;
}

const makeRect = (): DOMRect =>
  ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

describe('App', () => {
  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCtxMock() as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(makeRect());

    if (typeof HTMLCanvasElement.prototype.setPointerCapture !== 'function') {
      Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
        value: () => {},
        writable: true,
        configurable: true,
      });
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation(() => {});

    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: SocketService,
          useValue: {
            boardState$: new Subject<BoardState>().asObservable(),
            drawAction$: new Subject<WireDrawAction>().asObservable(),
            cursorMove$: new Subject<CursorEvent>().asObservable(),
            userJoined$: new Subject<WhiteboardUser>().asObservable(),
            userLeft$: new Subject<string>().asObservable(),
            usersRoster$: new Subject<WhiteboardUser[]>().asObservable(),
            emitAction: (_p: DrawEventPayload) => EMPTY,
            emitCursor: () => {},
            joinBoard: () => {},
            ngOnDestroy: () => {},
          } as unknown as SocketService,
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates the root component without throwing', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the canvas, cursor overlay, and toolbar child components', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-canvas')).toBeTruthy();
    expect(el.querySelector('app-cursor-overlay')).toBeTruthy();
    expect(el.querySelector('app-toolbar')).toBeTruthy();
  });
});
