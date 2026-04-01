import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(require('express').json());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const connection = app.get<Connection>(getConnectionToken());
  console.log(`\x1b[32m✔\x1b[0m 🚀 Server running on port \x1b[36m${port}\x1b[0m`);
  console.log(`\x1b[32m✔\x1b[0m 🍃 Connected to MongoDB: \x1b[36m${connection.host}\x1b[0m`);
}
bootstrap();
