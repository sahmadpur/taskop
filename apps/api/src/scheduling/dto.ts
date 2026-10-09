import { createShiftInputSchema, shiftDtoSchema, shiftListQuerySchema, updateShiftInputSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ShiftListQueryDto extends createZodDto(shiftListQuerySchema) {}
export class CreateShiftDto extends createZodDto(createShiftInputSchema) {}
export class UpdateShiftDto extends createZodDto(updateShiftInputSchema) {}
export class ShiftResponse extends createZodDto(shiftDtoSchema) {}
