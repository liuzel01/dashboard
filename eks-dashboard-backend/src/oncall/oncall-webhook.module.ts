import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OncallWebhookController } from './oncall-webhook.controller';
import { OncallCoreModule } from './oncall.module';

/** Minimal second HTTP surface, kept in the same Node process as Dashboard. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.local', '.env.development', '.env-example'] }), OncallCoreModule],
  controllers: [OncallWebhookController],
})
export class OncallWebhookModule {}
