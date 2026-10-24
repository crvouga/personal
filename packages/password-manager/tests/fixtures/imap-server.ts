import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
/** Deliberately synthetic loopback protocol server; no TLS downgrade is exposed
 * by production configuration. Exercises the real locked ImapFlow client. */
export async function imapServer() {
  const commands: string[] = [];
  let validity = 77;
  let rejectLogin = false;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.write('* OK [CAPABILITY IMAP4rev1] synthetic ready\r\n');
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        respond(socket, line);
      }
    });
  });
  function respond(socket: Socket, line: string): void {
    const [tag, name] = line.split(' ');
    commands.push(name!);
    const ok = () => socket.write(`${tag} OK done\r\n`);
    if (name === 'CAPABILITY') {
      socket.write('* CAPABILITY IMAP4rev1\r\n');
      ok();
    } else if (name === 'LOGIN') {
      if (rejectLogin)
        socket.write(`${tag} NO [AUTHENTICATIONFAILED] refused\r\n`);
      else ok();
    } else if (name === 'LIST') {
      socket.write('* LIST (\\Noselect) "/" ""\r\n');
      ok();
    } else if (name === 'EXAMINE') {
      socket.write(
        `* FLAGS (\\Seen)\r\n* 3 EXISTS\r\n* OK [UIDVALIDITY ${validity}] valid\r\n* OK [UIDNEXT 4] next\r\n${tag} OK [READ-ONLY] selected\r\n`
      );
    } else if (name === 'UID') respondUid(socket, line, tag!);
    else if (name === 'LOGOUT') {
      socket.write(`* BYE done\r\n${tag} OK done\r\n`);
      socket.end();
    } else ok();
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('fixture unavailable');
  return {
    port: address.port,
    commands,
    resetValidity: () => {
      validity++;
    },
    reject: () => {
      rejectLogin = true;
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

function respondUid(socket: Socket, line: string, tag: string): void {
  if (line.includes(' SEARCH')) {
    const range = /UID (\d+):(\d+)/.exec(line);
    const selected = [1, 2, 3].filter(
      (uid) => !range || (uid >= Number(range[1]) && uid <= Number(range[2]))
    );
    socket.write(`* SEARCH ${selected.join(' ')}\r\n${tag} OK done\r\n`);
    return;
  }
  const set = /UID FETCH ([\d,:]+)/.exec(line)?.[1] ?? '';
  const uids = set.split(',').flatMap((value) => {
    const [first, last] = value.split(':').map(Number);
    return [1, 2, 3].filter((uid) => uid >= first! && uid <= (last ?? first!));
  });
  for (const uid of uids) {
    const header = `From: security@vendor.test\r\nTo: synthetic@example.test\r\nSubject: Welcome SUBJECT_CANARY\r\nMessage-ID: <synthetic-${uid}@example.test>\r\n\r\n`;
    socket.write(
      `* ${uid} FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)] {${Buffer.byteLength(header)}}\r\n${header})\r\n`
    );
  }
  socket.write(`${tag} OK done\r\n`);
}
