/**
 * Composição das peças puras da gravação com o armazenamento real (SQLite).
 * As telas e o hook importam daqui; os testes montam as mesmas peças com
 * armazenamento falso.
 */
import { sqliteJournalStore } from '../storage/journalStore';
import { RecordingJournal } from './journal';

/** Diário único do processo: há no máximo uma gravação por vez. */
export const journal = new RecordingJournal(sqliteJournalStore);
