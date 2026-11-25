import { RadioGroup, Text } from '@radix-ui/themes'
import { useTranslation } from 'react-i18next'
import type { Role } from '#@/api/types.ts'

// Each role and what it adds to the one before, in the order of what they may do
const roles: { description: string; label: string; value: Role }[] = [
  { description: 'auth.playerDescription', label: 'auth.player', value: 'player' },
  { description: 'auth.contributorDescription', label: 'auth.contributor', value: 'contributor' },
  { description: 'auth.adminDescription', label: 'auth.admin', value: 'admin' },
]

/** An account's role, picked from the three with what each may do under its name */
export function RolePicker({
  defaultValue,
  disabled,
  name,
  onValueChange,
  value,
}: Readonly<{
  defaultValue?: Role
  disabled?: boolean
  name?: string
  onValueChange?: (role: Role) => unknown
  value?: Role
}>) {
  const { t } = useTranslation()
  return (
    <div>
      <div className='mb-2 text-sm font-medium'>{t('auth.role')}</div>
      <RadioGroup.Root
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        onValueChange={(role) => onValueChange?.(role as Role)}
        value={value}
      >
        {roles.map(({ description, label, value: role }) => (
          <RadioGroup.Item key={role} value={role}>
            <span className='flex flex-col'>
              <Text size='2' weight='medium'>
                {t(label)}
              </Text>
              <Text className='opacity-70' size='1'>
                {t(description)}
              </Text>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}
