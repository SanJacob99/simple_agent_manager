import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from './SchemaForm';
import type { ObjectSchema } from './types';

interface Sample {
  name: string;
  password: string;
  notes: string;
  provider: string;
  count: number;
  enabled: boolean;
}

const sampleSchema: ObjectSchema<Sample> = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name', placeholder: 'Your name' },
    password: { type: 'string', title: 'API Key', format: 'password' },
    notes: { type: 'string', title: 'Notes', format: 'textarea', textareaRows: 2 },
    provider: {
      type: 'string',
      title: 'Provider',
      enum: [
        { value: '', label: '(none)' },
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
    },
    count: { type: 'integer', title: 'Count', minimum: 0, maximum: 10 },
    enabled: { type: 'boolean', title: 'Active', checkboxLabel: 'Enabled' },
  },
};

function baseValue(): Sample {
  return { name: '', password: '', notes: '', provider: '', count: 0, enabled: false };
}

describe('SchemaForm', () => {
  it('renders every field in the schema with its title', () => {
    render(<SchemaForm schema={sampleSchema} value={baseValue()} onChange={() => {}} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a password input for format=password', () => {
    const { container } = render(
      <SchemaForm schema={sampleSchema} value={baseValue()} onChange={() => {}} />,
    );
    const pw = container.querySelector('input[type="password"]');
    expect(pw).not.toBeNull();
  });

  it('renders a textarea for format=textarea with the requested rows', () => {
    const { container } = render(
      <SchemaForm schema={sampleSchema} value={baseValue()} onChange={() => {}} />,
    );
    const ta = container.querySelector('textarea');
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute('rows')).toBe('2');
  });

  it('renders a select when enum is provided', () => {
    const { container } = render(
      <SchemaForm schema={sampleSchema} value={baseValue()} onChange={() => {}} />,
    );
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    const options = Array.from(select!.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['(none)', 'Alpha', 'Beta']);
  });

  it('emits partial onChange patches keyed by field name', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SchemaForm schema={sampleSchema} value={baseValue()} onChange={onChange} />,
    );
    const nameInput = container.querySelector('input[type="text"]')!;
    fireEvent.change(nameInput, { target: { value: 'Jacob' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Jacob' });

    const checkbox = container.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });

    const numberInput = container.querySelector('input[type="number"]')!;
    fireEvent.change(numberInput, { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ count: 5 });
  });

  it('skips integer onChange when the input is not a finite number', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SchemaForm schema={sampleSchema} value={baseValue()} onChange={onChange} />,
    );
    const numberInput = container.querySelector('input[type="number"]')!;
    fireEvent.change(numberInput, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies fieldOverrides placeholder and description at render time', () => {
    const { container } = render(
      <SchemaForm
        schema={sampleSchema}
        value={baseValue()}
        onChange={() => {}}
        fieldOverrides={{
          name: { placeholder: 'Inherited: alice', description: 'Overridden hint.' },
        }}
      />,
    );
    const nameInput = container.querySelector('input[type="text"]')!;
    expect(nameInput.getAttribute('placeholder')).toBe('Inherited: alice');
    expect(screen.getByText('Overridden hint.')).toBeInTheDocument();
  });

  it('hides a field when fieldOverrides[name].hidden is true', () => {
    const { container } = render(
      <SchemaForm
        schema={sampleSchema}
        value={baseValue()}
        onChange={() => {}}
        fieldOverrides={{ count: { hidden: true } }}
      />,
    );
    expect(screen.queryByText('Count')).toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });

  it('renders section headers immediately before each section.startAt field', () => {
    interface Layered {
      prelude: string;
      alphaOne: string;
      alphaTwo: string;
      betaOne: string;
    }
    const schema: ObjectSchema<Layered> = {
      type: 'object',
      properties: {
        prelude: { type: 'string', title: 'Prelude' },
        alphaOne: { type: 'string', title: 'Alpha 1' },
        alphaTwo: { type: 'string', title: 'Alpha 2' },
        betaOne: { type: 'string', title: 'Beta 1' },
      },
      sections: [
        { title: 'Alpha Section', description: 'Alpha hint', startAt: 'alphaOne' },
        { title: 'Beta Section', startAt: 'betaOne' },
      ],
    };
    const value: Layered = { prelude: '', alphaOne: '', alphaTwo: '', betaOne: '' };
    const { container } = render(
      <SchemaForm schema={schema} value={value} onChange={() => {}} />,
    );

    expect(screen.getByText('Alpha Section')).toBeInTheDocument();
    expect(screen.getByText('Alpha hint')).toBeInTheDocument();
    expect(screen.getByText('Beta Section')).toBeInTheDocument();

    // Verify ordering in the DOM: prelude → Alpha Section → Alpha 1 → Alpha 2 → Beta Section → Beta 1
    const texts = Array.from(container.querySelectorAll('label, p'))
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => Boolean(t));
    const idx = (needle: string) => texts.findIndex((t) => t.includes(needle));
    expect(idx('Prelude')).toBeLessThan(idx('Alpha Section'));
    expect(idx('Alpha Section')).toBeLessThan(idx('Alpha 1'));
    expect(idx('Alpha 1')).toBeLessThan(idx('Alpha 2'));
    expect(idx('Alpha 2')).toBeLessThan(idx('Beta Section'));
    expect(idx('Beta Section')).toBeLessThan(idx('Beta 1'));
  });
});
