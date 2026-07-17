import TextField from './TextField'
import TextAreaField from './TextAreaField'
import SelectField from './SelectField'
import CheckboxGroup from './CheckboxGroup'
import DurationField from './DurationField'
import DateWheelField from './DateWheelField'
import RadioGroup from './RadioGroup'
import StarRating from './StarRating'
import {
  isNationalIdField,
  formatThaiNationalId,
  THAI_NATIONAL_ID_MAX_LENGTH,
  THAI_NATIONAL_ID_PLACEHOLDER,
} from '../../lib/fieldFormat'

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

    case 'date':
      // เดิมใช้ input type="date" ของเบราว์เซอร์ แต่บน Android/Chrome จะเป็นปฏิทินตาราง
      // ต้องกดเปลี่ยนปีทีละปี ผู้สูงอายุใช้ยาก — เปลี่ยนมาใช้ wheel picker ที่เขียนเอง เลื่อนนิ้วได้ตรงๆ
      // ทุกเครื่อง เก็บค่าเป็น string "YYYY-MM-DD" เหมือนเดิม
      return (
        <div>
          <DateWheelField
            label={field.label}
            required={field.is_required}
            value={value ?? ''}
            onChange={onChange}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'duration':
      // สำหรับคำถามแบบระยะเวลา เช่น "เวลาเดินทางมาจุดนัดพบ" — เลือกชั่วโมง+นาทีแยกกัน
      // เก็บรวมเป็น string เดียว "HH:MM"
      return (
        <div>
          <DurationField
            label={field.label}
            required={field.is_required}
            value={value ?? ''}
            onChange={onChange}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'radio':
      return (
        <div>
          <RadioGroup
            label={field.label}
            required={field.is_required}
            options={options}
            value={value ?? ''}
            onChange={onChange}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'rating':
      return (
        <div>
          <StarRating
            label={field.label}
            required={field.is_required}
            value={value ?? ''}
            onChange={onChange}
          />
          {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        </div>
      )

    case 'text':
    default: {
      // ฟิลด์เลขบัตรประชาชน — จัดรูป X-XXXX-XXXXX-XX-X และจำกัด 13 หลัก
      if (isNationalIdField(field)) {
        return (
          <div>
            <TextField
              label={field.label}
              required={field.is_required}
              type="text"
              inputMode="numeric"
              maxLength={THAI_NATIONAL_ID_MAX_LENGTH}
              placeholder={THAI_NATIONAL_ID_PLACEHOLDER}
              value={value ?? ''}
              onChange={(e) => onChange(formatThaiNationalId(e.target.value))}
            />
            {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
          </div>
        )
      }
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
}
