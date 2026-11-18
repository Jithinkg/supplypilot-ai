import { calculatorSchema } from '@supplypilot/contracts';

export function calculate(input: unknown) {
  const { operation, a, b } = calculatorSchema.parse(input);
  return operation === 'add' ? a + b : a * b;
}
