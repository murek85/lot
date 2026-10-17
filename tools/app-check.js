// npm run app:check: uruchamia aplikację desktopową w trybie samosprawdzenia (electron/main.cjs, selfCheck) –
// wczytuje grę, startuje lot, wypisuje raport z błędami strony i kończy się; kod wyjścia mówi, czy działa.
// LOT_SHOT=<plik.png> – dodatkowo zrzut okna z lotu.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const root = path.join(import.meta.dirname, '..');
const r = spawnSync(electron, [root], { stdio: 'inherit', env: { ...process.env, LOT_CHECK: '1' } });
process.exit(r.status ?? 1);
