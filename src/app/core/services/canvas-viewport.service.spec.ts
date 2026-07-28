import { TestBed } from '@angular/core/testing';
import { CanvasViewportService } from './canvas-viewport.service';

describe('CanvasViewportService', () => {
  let service: CanvasViewportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CanvasViewportService);
  });

  it('starts at zero size', () => {
    expect(service.size()).toEqual({ width: 0, height: 0 });
  });

  it('reflects the most recently published size', () => {
    service.setSize({ width: 800, height: 600 });
    expect(service.size()).toEqual({ width: 800, height: 600 });

    service.setSize({ width: 1024, height: 768 });
    expect(service.size()).toEqual({ width: 1024, height: 768 });
  });
});
