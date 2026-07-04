import TextField from './TextField'
import TextAreaField from './TextAreaField'
import SelectField from './SelectField'
import CheckboxGroup from './CheckboxGroup'

// Renders one form_fields row as the correct input type.
// `value` / `onChange` follow a uniform (string | string[]) contract regardless of field_type.
export default function DynamicField({ field, value, onChange, error }) {
  const options = Array.isArray(field.options) ? field.options : []

  switch (field.field_type) {
    case 'textarea':
      return (
        <div>
          <TextAreaField
            label={field.label}
            required={field.is_required}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'select':
      return (
        <div>
          <SelectField
            label={field.label}
            required={field.is_required}
            options={options}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'checkbox':
      return (
        <div>
          <CheckboxGroup
            label={field.label}
            required={field.is_required}
            options={options}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'phone':
      return (
        <div>
          <TextField
            label={field.label}
            required={field.is_required}
            type="tel"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'text':
    default:
      return (
        <div>
          <TextField
            label={field.label}
            required={field.is_required}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )
  }
}
