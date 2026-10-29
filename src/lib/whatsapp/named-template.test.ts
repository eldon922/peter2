import { expect, it } from 'vitest';
import { buildMetaTemplatePayload } from './template-components';
import { buildSendComponents } from './template-send-builder';
import { validateTemplatePayload } from './template-validators';
import { renderTemplateBody } from './broadcast-message';
import {
  bodyPlaceholderKeys,
  resolveVariables,
} from '@/lib/broadcasts/variables';
import type { Contact, MessageTemplate } from '@/types';

it('creates, personalizes, previews and sends named variables consistently', () => {
  const template = {
    name: 'welcome',
    category: 'Marketing' as const,
    language: 'en_US',
    body_text: 'Hi {{customer_name}}, order {{order_id}} for {{customer_name}}',
    sample_values: { body: ['Dewi', '123'] },
  };
  expect(validateTemplatePayload(template).bodyVarCount).toBe(2);
  expect(buildMetaTemplatePayload(template)).toMatchObject({
    parameter_format: 'NAMED',
    components: [
      {
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Dewi' },
            { param_name: 'order_id', example: '123' },
          ],
        },
      },
    ],
  });
  expect(bodyPlaceholderKeys(template.body_text)).toEqual([
    'customer_name',
    'order_id',
  ]);
  const body = resolveVariables(
    {
      order_id: { type: 'static', value: '456' },
      customer_name: { type: 'field', value: 'name' },
    },
    { name: 'Sari' } as Contact
  );
  expect(renderTemplateBody(template.body_text, body)).toBe(
    'Hi Sari, order 456 for Sari'
  );
  expect(buildSendComponents(template as MessageTemplate, { body })).toEqual([
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Sari', parameter_name: 'customer_name' },
        { type: 'text', text: '456', parameter_name: 'order_id' },
      ],
    },
  ]);
});

it('rejects mixed formats and variables in footers', () => {
  const template = {
    name: 'test',
    category: 'Utility' as const,
    language: 'en_US',
    body_text: '{{1}} {{name}}',
  };
  expect(() => validateTemplatePayload(template)).toThrow(/mixing/);
  expect(() =>
    validateTemplatePayload({
      ...template,
      body_text: 'Hello',
      footer_text: '{{name}}',
    })
  ).toThrow(/Footer/);
});

it('sends a named text header with its parameter name', () => {
  expect(
    buildSendComponents(
      {
        header_type: 'text',
        header_content: 'Hi {{name}}',
        body_text: 'Welcome',
      } as MessageTemplate,
      { headerText: 'Dewi' }
    )
  ).toEqual([
    {
      type: 'header',
      parameters: [{ type: 'text', text: 'Dewi', parameter_name: 'name' }],
    },
  ]);
});
