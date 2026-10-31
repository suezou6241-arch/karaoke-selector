import { config } from './config.js';
import { createApp } from './app.js';

const server = createApp();

server.listen(config.port, config.host, () => {
  const addr = server.address();
  console.log(`カラオケ・セレクター: http://${config.host}:${addr.port}`);
  if (config.mbContact.includes('example.com')) {
    console.warn('注意: MB_CONTACT が初期値のままです。公開運用する場合は .env で自分の連絡先に変更してください。');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
