import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { APP_CONFIG, type AppConfig } from '../../config/config';

@Injectable()
export class PasswordHasher {
  private readonly dummyHash: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.dummyHash = this.hash('taskop-timing-equaliser');
  }

  /** argon2id (the library default algorithm) with configured cost. */
  hash(secret: string): Promise<string> {
    return hash(secret, {
      memoryCost: this.config.ARGON2_MEMORY_KIB,
      timeCost: this.config.ARGON2_ITERATIONS,
      parallelism: 1,
    });
  }

  async verify(storedHash: string | null, secret: string): Promise<boolean> {
    if (!storedHash) {
      await verify(await this.dummyHash, secret).catch(() => false);
      return false;
    }
    try {
      return await verify(storedHash, secret);
    } catch {
      return false;
    }
  }
}
