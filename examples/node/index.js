// @ts-check

const { Uploadx, DiskStorage } = require('../../dist');
const http = require('http');
const url = require('url');
const { tmpdir } = require('os');

class DiskStorageEx extends DiskStorage {
  // allow to get list of all files
  list(req) {
    return Promise.resolve(Object.values(this.metaStore.all).filter(f => req.user.id === f.userId));
  }
}
const storage = new DiskStorageEx({ dest: (req, file) => `${tmpdir()}/ngx/${file.filename}` });
const uploads = new Uploadx({ storage });
uploads.on('error', console.error);
uploads.on('created', console.log);
uploads.on('complete', console.log);
uploads.on('deleted', console.log);

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname.toLowerCase();
  if (pathname === '/upload') {
    uploads.handle(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plan' });
    res.end('Not Found');
  }
});

server.listen(3003, error => {
  if (error) {
    return console.error('something bad happened', error);
  }
  console.log('listening on port:', server.address()['port']);
});
