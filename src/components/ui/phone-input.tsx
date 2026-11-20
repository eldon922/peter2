'use client';
import AutoNumeric from 'autonumeric';
import { Input } from './input';

export function PhoneInput({
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'onChange'> & {
  onValueChange: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      type="tel"
      onChange={({ target }) => {
        const value = target.value;
        // Preserve the dialing prefix, including a standalone + while typing.
        const match = /^(\+?)(\d{1,15})$/.exec(value);
        onValueChange(
          match
            ? match[1] +
                AutoNumeric.format(match[2], {
                  decimalPlaces: 0,
                  digitGroupSeparator: '',
                  leadingZero: 'keep',
                  minimumValue: '0',
                  maximumValue: '999999999999999',
                })
            : value
        );
      }}
    />
  );
}
