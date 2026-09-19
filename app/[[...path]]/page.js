import fs from 'node:fs';
import path from 'node:path';
import LegacyRuntime from '../legacy-runtime';

export const dynamic = 'force-dynamic';

function readApplicationShell() {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'client', 'index.html'), 'utf8');
  const match = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('The application shell is missing a body element.');
  return match[1].replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

export default function ApplicationPage() {
  return (
    <>
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: readApplicationShell() }} />
      <LegacyRuntime />
    </>
  );
}
