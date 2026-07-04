// Resolve a guest's phone number regardless of whether "phone" is the built-in
// core field (guests.phone) or a custom field an admin added via FormBuilder
// tagged with field_purpose = 'phone'. Dashboard/CheckIn call this instead of
// hardcoding guests.phone so the UI keeps working after form customization.

// responsesByGuestId: { [guestId]: { [fieldId]: value } }
// phoneField: the form_fields row with field_purpose === 'phone' (or null)
export function resolveGuestPhone(guest, phoneField, responsesByGuestId) {
  if (!phoneField) return guest.phone ?? null
  if (phoneField.is_core) return guest[phoneField.field_key] ?? guest.phone ?? null

  const responses = responsesByGuestId?.[guest.id]
  return responses?.[phoneField.id] ?? null
}

export function findFieldByPurpose(fields, purpose) {
  return fields.find((f) => f.field_purpose === purpose && f.is_active) ?? null
}

export function buildResponsesByGuestId(responses) {
  const map = {}
  for (const r of responses) {
    if (!map[r.guest_id]) map[r.guest_id] = {}
    map[r.guest_id][r.field_id] = r.value
  }
  return map
}
