/** The shapes the DTS sign-in service answers with (see src/dts/internal/api). */

export interface DtsEntry {
  id: string;
  licence?: string;
  name: string;
  cap: string;
  t1?: string;
  t2?: string;
  signed: boolean;
  signedAt?: string;
  signedBy?: string;
  minutesLate?: number;
  added?: boolean;
  /** The number typed for an added racer that is not in the file. */
  newLicence?: string;
  changed?: boolean;
  /** The number and transponders of the uploaded file, on a changed entry that is in the file. */
  orig?: { cap: string; t1?: string; t2?: string };
}

export interface DtsRace {
  id: string;
  code: string;
  name: string;
  /** `<place> - HH.mm - <name>`, how a race is shown to people. */
  title: string;
  /** The category the title ends with, shown apart from the rest of it. */
  category?: string;
  /** An admin closed the race: signers can no longer change it. */
  closed?: boolean;
  start: string;
  cutoffMinutes: number;
  cutoffAt: string;
  cutoffCustom?: boolean;
  signed: number;
  unsigned: number;
  late: number;
  entries: DtsEntry[];
}

export interface DtsWarning {
  level: 'severe' | 'light';
  kind: 'cap' | 'transponder';
  value: string;
  race?: string;
  entries: string[];
}

export interface DtsNote {
  id: string;
  entry: string;
  level: 'note' | 'warning';
  text: string;
  by: string;
  at: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface DtsAction {
  id: string;
  at: string;
  kind: string;
  entry?: string;
  old?: string;
  new?: string;
  text?: string;
  by?: string;
  device?: string;
}

export interface DtsDevice {
  id: string;
  name: string;
  lastSeen: string;
  signs: number;
  changes: number;
  offsetMs: number;
  clockOff?: boolean;
}

export interface DtsState {
  id: string;
  now: string;
  changed?: string;
  synced?: string;
  races: DtsRace[];
  warnings: DtsWarning[];
  notes: DtsNote[];
  latestActions: DtsAction[];
  totals: Record<string, number>;
  devices: DtsDevice[];
}

export type DtsOpKind = 'sign' | 'cap' | 'transponder1' | 'transponder2' | 'race' | 'add-racer';

export interface DtsOp {
  id: string;
  at: string;
  kind: DtsOpKind;
  entry?: string;
  value?: string;
  device?: string;
  deviceAt?: string;
  who?: string;
  licence?: string;
  race?: string;
  cap?: string;
  t1?: string;
  t2?: string;
  signed?: boolean;
}

export interface DtsNoteEvent {
  id: string;
  at: string;
  kind: 'add' | 'resolve';
  noteId?: string;
  entry?: string;
  level?: 'note' | 'warning';
  text?: string;
}

export interface DtsCursor {
  ops: number;
  actions: number;
  notes: number;
}

export interface DtsSyncAnswer {
  cursor: DtsCursor;
  time: string;
  ops: DtsOp[];
  actions: DtsAction[];
  notes: DtsNoteEvent[];
  state: DtsState;
}

export interface DtsCreated {
  id: string;
  signKey: string;
  manageKey: string;
  warnings: string[];
}
