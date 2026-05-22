import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhiteboardService } from '../whiteboard.service';
import { ToolbarComponent } from './toolbar.component';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Dispatch a keydown event on document (where the @HostListener is bound). */
function keydown(key: string, extra: Partial<KeyboardEventInit> = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ToolbarComponent — keyboard shortcuts', () => {
  let fixture: ComponentFixture<ToolbarComponent>;
  let service: WhiteboardService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolbarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolbarComponent);
    service = TestBed.inject(WhiteboardService);
    fixture.detectChanges();
  });

  // Destroy the component so @HostListener is unregistered between tests.
  afterEach(() => fixture.destroy());

  // ── Ctrl+Z ────────────────────────────────────────────────────────────────

  it('Ctrl+Z calls undo() exactly once per keypress (5 presses = 5 undos)', () => {
    const spy = vi.spyOn(service, 'undo');

    for (let i = 0; i < 5; i++) {
      keydown('z', { ctrlKey: true });
    }

    expect(spy).toHaveBeenCalledTimes(5);
  });

  // ── Tool shortcuts ────────────────────────────────────────────────────────

  it('P switches the active tool to pen', () => {
    service.tool$.set('eraser');
    keydown('p');
    expect(service.tool$()).toBe('pen');
  });

  it('E switches the active tool to eraser', () => {
    keydown('e');
    expect(service.tool$()).toBe('eraser');
  });

  it('R switches the active tool to rect', () => {
    keydown('r');
    expect(service.tool$()).toBe('rect');
  });

  it('L switches the active tool to ellipse', () => {
    keydown('l');
    expect(service.tool$()).toBe('ellipse');
  });

  it('uppercase keys also trigger tool shortcuts (caps-lock tolerance)', () => {
    keydown('P');
    expect(service.tool$()).toBe('pen');
  });

  // ── Input-element guard ───────────────────────────────────────────────────

  it('shortcuts are blocked when the event target is an input element', () => {
    const spy = vi.spyOn(service, 'undo');
    const input = document.createElement('input');
    document.body.appendChild(input);

    // Event dispatched from the input bubbles to document, but e.target === input
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );

    expect(spy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
