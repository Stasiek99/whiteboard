import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RemoteCursor, RemoteUsersService } from '../../../core/services/remote-users.service';
import { CursorOverlayComponent } from './cursor-overlay.component';

const makeCursor = (overrides: Partial<RemoteCursor> = {}): RemoteCursor => ({
  id: 'a',
  name: 'BraveOtter7',
  color: '#ff0000',
  x: 0.5,
  y: 0.5,
  hidden: false,
  ...overrides,
});

describe('CursorOverlayComponent', () => {
  let fixture: ComponentFixture<CursorOverlayComponent>;
  let cursorsSignal: ReturnType<typeof signal<RemoteCursor[]>>;

  beforeEach(async () => {
    cursorsSignal = signal<RemoteCursor[]>([]);

    await TestBed.configureTestingModule({
      imports: [CursorOverlayComponent],
      providers: [
        {
          provide: RemoteUsersService,
          useValue: { cursors: cursorsSignal.asReadonly() } as unknown as RemoteUsersService,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CursorOverlayComponent);
    fixture.detectChanges();
  });

  it('renders no cursor elements when there are no remote users', () => {
    const cursors = fixture.nativeElement.querySelectorAll('.cursor');
    expect(cursors.length).toBe(0);
  });

  it('renders one cursor element per remote user', () => {
    cursorsSignal.set([
      makeCursor({ id: 'a', name: 'BraveOtter7', color: '#ff0000', x: 0.2, y: 0.3 }),
      makeCursor({ id: 'b', name: 'QuietFox1', color: '#00ff00', x: 0.6, y: 0.7 }),
    ]);
    fixture.detectChanges();

    const cursors = fixture.nativeElement.querySelectorAll('.cursor');
    expect(cursors.length).toBe(2);
  });

  it('renders an SVG arrow and a nametag pill with the user name for each cursor', () => {
    cursorsSignal.set([makeCursor()]);
    fixture.detectChanges();

    const cursor = fixture.nativeElement.querySelector('.cursor');
    expect(cursor.querySelector('svg.arrow')).toBeTruthy();
    const nametag = cursor.querySelector('.nametag');
    expect(nametag.textContent.trim()).toBe('BraveOtter7');
  });

  it('applies the user color to both the arrow and the nametag', () => {
    cursorsSignal.set([makeCursor()]);
    fixture.detectChanges();

    const cursor = fixture.nativeElement.querySelector('.cursor');
    const svg = cursor.querySelector('svg.arrow') as SVGElement;
    const nametag = cursor.querySelector('.nametag') as HTMLElement;

    expect(svg.style.fill).toBe('rgb(255, 0, 0)');
    expect(nametag.style.background).toBe('rgb(255, 0, 0)');
  });

  it('positions each cursor using normalized coordinates as percentages', () => {
    cursorsSignal.set([makeCursor({ x: 0.25, y: 0.75 })]);
    fixture.detectChanges();

    const cursor = fixture.nativeElement.querySelector('.cursor') as HTMLElement;
    expect(cursor.style.left).toBe('25%');
    expect(cursor.style.top).toBe('75%');
  });

  it('re-renders when the cursors signal updates (join/leave)', () => {
    cursorsSignal.set([makeCursor()]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cursor').length).toBe(1);

    cursorsSignal.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cursor').length).toBe(0);
  });

  it('the host does not intercept pointer events over the canvas', () => {
    const hostStyles = getComputedStyle(fixture.nativeElement);
    expect(hostStyles.pointerEvents).toBe('none');
  });

  // ── idle-hide (visibility, not *ngIf/@if) ────────────────────────────────

  describe('hidden state', () => {
    it('is visible by default', () => {
      cursorsSignal.set([makeCursor({ hidden: false })]);
      fixture.detectChanges();

      const cursor = fixture.nativeElement.querySelector('.cursor') as HTMLElement;
      expect(cursor.style.visibility).toBe('visible');
    });

    it('sets visibility: hidden on the element without removing it from the DOM', () => {
      cursorsSignal.set([makeCursor({ hidden: true })]);
      fixture.detectChanges();

      const cursors = fixture.nativeElement.querySelectorAll('.cursor');
      expect(cursors.length).toBe(1);
      expect((cursors[0] as HTMLElement).style.visibility).toBe('hidden');
    });

    it('toggling hidden back to false on the same entry keeps the same DOM node (no @if removal)', () => {
      cursorsSignal.set([makeCursor({ id: 'a', hidden: true })]);
      fixture.detectChanges();
      const before = fixture.nativeElement.querySelector('.cursor') as HTMLElement;

      cursorsSignal.set([makeCursor({ id: 'a', hidden: false })]);
      fixture.detectChanges();
      const after = fixture.nativeElement.querySelector('.cursor') as HTMLElement;

      expect(after).toBe(before);
      expect(after.style.visibility).toBe('visible');
    });
  });
});
