import { TestBed } from '@angular/core/testing';
import { WhiteboardUser } from '../models/user.model';
import { UserService } from './user.service';

const STORAGE_KEY = 'whiteboard:user';

describe('UserService', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  // ── Generation ────────────────────────────────────────────────────────────

  describe('when sessionStorage is empty', () => {
    it('generates a WhiteboardUser with an adjective+noun+number name', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      expect(service.currentUser.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
    });

    it('assigns a color from the palette', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      expect(service.currentUser.color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('assigns a unique id', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      expect(service.currentUser.id).toBeTruthy();
    });

    it('persists the generated user to sessionStorage', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as WhiteboardUser;
      expect(stored).toEqual(service.currentUser);
    });
  });

  // ── Reuse across reconnects (same tab lifetime) ──────────────────────────

  describe('when sessionStorage already has a user', () => {
    const existing: WhiteboardUser = { id: 'existing-id', name: 'BraveFalcon42', color: '#123456' };

    beforeEach(() => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    });

    it('reuses the existing user instead of generating a new one', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      expect(service.currentUser).toEqual(existing);
    });

    it('does not overwrite sessionStorage on reuse', () => {
      TestBed.configureTestingModule({});
      TestBed.inject(UserService);

      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!) as WhiteboardUser;
      expect(stored).toEqual(existing);
    });
  });

  describe('session continuity across reconnects', () => {
    it('keeps the same id when re-inject simulates a reconnect within the same TestBed instance', () => {
      TestBed.configureTestingModule({});
      const first = TestBed.inject(UserService).currentUser.id;
      const second = TestBed.inject(UserService).currentUser.id;

      expect(second).toBe(first);
    });

    it('keeps the same id across separate service instances sharing sessionStorage (new socket connection, same tab)', () => {
      TestBed.configureTestingModule({});
      const firstId = TestBed.inject(UserService).currentUser.id;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const secondId = TestBed.inject(UserService).currentUser.id;

      expect(secondId).toBe(firstId);
    });
  });

  // ── Corrupt storage fallback ──────────────────────────────────────────────

  describe('when sessionStorage contains malformed JSON', () => {
    beforeEach(() => {
      sessionStorage.setItem(STORAGE_KEY, '{not-json');
    });

    it('falls back to generating a fresh user', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(UserService);

      expect(service.currentUser.id).toBeTruthy();
      expect(service.currentUser.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
    });
  });
});
