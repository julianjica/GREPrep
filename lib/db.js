// Tiny JSON-file store. Everything the student does lives in data/db.json on the host computer.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = () => ({
  profile: {
    onboarded: false,
    targetQuant: 165,
    targetVerbal: 160,
    testDate: Date.now() + 42 * 86400000,
    dailyMinutes: 30,
    provider: 'claude', // AI assistant CLI: 'claude' (Claude Code) or 'codex' (ChatGPT Codex)
    model: '',          // Claude Code model; empty = Claude Code's default
    codexModel: '',     // Codex model; empty = Codex's default
  },
  attempts: [],         // {questionId, topic, type, section, difficulty, correct, seconds, date}
  mistakes: {},         // questionId -> {question, reason, due, streak, misses, mastered, lastSeen}
  saved: [],            // AI questions that passed validation: {question, checks, created}
  essays: [],           // {id, date, prompt, text, feedback}
  vocab: {},            // word -> box (0..4)
  planDone: [],         // plan task ids
  chats: [],            // {id, title, provider, sessionId, created, updated, context, messages:[{role, text, at}]}
});

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = DEFAULTS();
    if (fs.existsSync(this.file)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const d = DEFAULTS();
        this.data = { ...d, ...loaded, profile: { ...d.profile, ...(loaded.profile ?? {}) } };
      } catch (err) {
        const backup = this.file + '.corrupt-' + Date.now();
        fs.copyFileSync(this.file, backup);
        console.error(`Could not read ${this.file}; saved a copy to ${backup} and started fresh.`);
      }
    }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    const keepProfile = this.data.profile;
    this.data = DEFAULTS();
    this.data.profile = keepProfile;
    this.flush();
  }
}
