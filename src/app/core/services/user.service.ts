import { Injectable, isDevMode } from '@angular/core';
import { WhiteboardUser } from '../models/user.model';

const STORAGE_KEY = 'whiteboard:user';

const ADJECTIVES = [
  'Swift', 'Quiet', 'Bold', 'Gentle', 'Clever', 'Bright', 'Calm', 'Eager',
  'Fuzzy', 'Jolly', 'Lucky', 'Mighty', 'Nimble', 'Plucky', 'Quirky', 'Sly',
  'Witty', 'Zesty', 'Brave', 'Curious',
];

const NOUNS = [
  'Otter', 'Falcon', 'Panda', 'Tiger', 'Heron', 'Wolf', 'Fox', 'Lynx',
  'Raven', 'Badger', 'Dolphin', 'Koala', 'Moose', 'Owl', 'Rabbit', 'Sparrow',
  'Turtle', 'Walrus', 'Yak', 'Zebra',
];

const COLORS = [
  '#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec',
  '#ff006e', '#3a86ff', '#06d6a0', '#ffbe0b', '#fb5607',
];

@Injectable({ providedIn: 'root' })
export class UserService {
  readonly currentUser: WhiteboardUser;

  constructor() {
    this.currentUser = this.loadOrCreateUser();
    if (isDevMode()) (window as any).__e2e_user = this.currentUser;
  }

  /**
   * sessionStorage (not localStorage) scopes identity to the tab lifetime — reused across
   * socket reconnects (which don't touch storage) but not across a fresh tab.
   */
  private loadOrCreateUser(): WhiteboardUser {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as WhiteboardUser;
      } catch {
        // corrupt entry — fall through and generate a fresh user
      }
    }

    const user = this.generateUser();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    return user;
  }

  private generateUser(): WhiteboardUser {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const number = Math.floor(Math.random() * 100);

    return {
      id: crypto.randomUUID(),
      name: `${adjective}${noun}${number}`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }
}
