import { Injectable, PipeTransform } from '@nestjs/common';
import { AppError } from './app-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw new AppError('NOT_FOUND');
    return value.toLowerCase();
  }
}
