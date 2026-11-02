import { type FormEvent, type ReactNode, useId, useState } from 'react'

type Field = { name: string; label: string; placeholder?: string; inputMode?: 'decimal' }

type Props = {
  fields: Field[]
  submitLabel: string
  disabled?: boolean
  onSubmit: (values: Record<string, string>) => Promise<void>
  children?: ReactNode
}

export function TextForm({ fields, submitLabel, disabled, onSubmit, children }: Props) {
  const baseId = useId()
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onSubmit(values)
      setValues({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row">
        {fields.map((field) => (
          <div className="field" key={field.name}>
            <label htmlFor={`${baseId}-${field.name}`}>{field.label}</label>
            <input
              id={`${baseId}-${field.name}`}
              value={values[field.name] ?? ''}
              placeholder={field.placeholder}
              inputMode={field.inputMode}
              autoComplete="off"
              required
              disabled={disabled}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
            />
          </div>
        ))}
        <button type="submit" className="button" disabled={disabled || pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
      {children}
      {error && (
        <p className="message message-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
