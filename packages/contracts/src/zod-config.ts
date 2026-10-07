import { z } from 'zod';

// Every default Zod message becomes an i18n key, so API field errors and client form
// errors are always translatable. Schema-specific `error` params take precedence.
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined || iss.input === null
          ? 'errors.validation.required'
          : 'errors.validation.invalid';
      case 'too_small':
        return iss.origin === 'string' && iss.minimum === 1
          ? 'errors.validation.required'
          : 'errors.validation.tooShort';
      case 'too_big':
        return 'errors.validation.tooLong';
      default:
        return 'errors.validation.invalid';
    }
  },
});
