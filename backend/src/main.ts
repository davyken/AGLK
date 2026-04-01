import * as crypto from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use((req, res, next) => {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      try {
        req.rawBody = rawBody;
        req.body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        req.body = {};
      }
      if (req.method === 'POST' && req.url === '/webhook') {
        const appSecret = process.env.META_APP_SECRET;
        const signature = req.headers['x-hub-signature-256'] as string;

        if (!appSecret) {
          console.warn('[WARN] META_APP_SECRET is not set — HMAC validation skipped');
        } else if (!signature) {
          res.status(403).json({ message: 'Forbidden' });
          return;
        } else {
          const expected =
            'sha256=' +
            crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

          let valid = false;
          try {
            // timingSafeEqual prevents timing-based attacks; throws if lengths differ
            valid = crypto.timingSafeEqual(
              Buffer.from(signature),
              Buffer.from(expected),
            );
          } catch {
            valid = false;
          }

          if (!valid) {
            res.status(403).json({ message: 'Forbidden' });
            return;
          }
        }
      }

      next();
    });
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`Server running on port ${process.env.PORT ?? 3000}`);
}
bootstrap();
