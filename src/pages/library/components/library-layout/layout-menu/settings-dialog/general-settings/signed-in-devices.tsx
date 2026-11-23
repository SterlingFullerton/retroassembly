import { Badge, Button, Flex, Text } from '@radix-ui/themes'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { client, parseResponse } from '#@/api/client.ts'
import { useAgo } from '#@/pages/library/platform/rom/components/use-ago.ts'

const browsers: [RegExp, string][] = [
  [/Edg\//u, 'Edge'],
  [/Firefox\//u, 'Firefox'],
  [/Chrome\//u, 'Chrome'],
  [/Safari\//u, 'Safari'],
]
const systems: [RegExp, string][] = [
  [/iPhone/u, 'iPhone'],
  [/iPad/u, 'iPad'],
  [/Android/u, 'Android'],
  [/Windows/u, 'Windows'],
  [/Mac OS X|Macintosh/u, 'Mac'],
  [/Linux/u, 'Linux'],
]

/** A device as a few words, from what its browser calls itself: "Firefox, Mac" */
export function describeDevice(userAgent: null | string) {
  const browser = browsers.find(([pattern]) => pattern.test(userAgent ?? ''))?.[1]
  const system = systems.find(([pattern]) => pattern.test(userAgent ?? ''))?.[1]
  return [browser, system].filter(Boolean).join(', ') || userAgent || '?'
}

/** Where the user is signed in, and a button that signs them out everywhere else */
export function SignedInDevices() {
  const { t } = useTranslation()
  const ago = useAgo()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const { data: devices, mutate } = useSWR({ endpoint: 'sessions', method: 'get' }, () =>
    parseResponse(client.sessions.$get()),
  )

  async function handleSignOutOthers() {
    setBusy(true)
    setError(null)
    try {
      await client.sessions.others.$delete()
      await mutate()
    } catch (error) {
      setError((error as { message?: string })?.message || t('error.unknown'))
    } finally {
      setBusy(false)
    }
  }

  if (!devices) {
    return null
  }
  return (
    <div className='flex flex-col gap-2 lg:w-xl'>
      <Flex align='center' className='pt-4' gap='2'>
        <span className='icon-[mdi--devices]' />
        <Text size='3' weight='bold'>
          {t('auth.devices')}
        </Text>
      </Flex>
      <ul className='flex flex-col gap-1'>
        {devices.map((device) => (
          <li className='flex items-center justify-between gap-3 text-sm' key={device.id}>
            <span className='min-w-0 truncate'>
              {describeDevice(device.userAgent)}
              {device.current ? (
                <Badge color='grass' ml='2' size='1'>
                  {t('auth.thisDevice')}
                </Badge>
              ) : null}
            </span>
            <span className='shrink-0 opacity-70'>{ago(device.lastActivityAt)}</span>
          </li>
        ))}
      </ul>
      {devices.length > 1 ? (
        <Button className='mt-2!' loading={busy} onClick={handleSignOutOthers} type='button' variant='soft'>
          <span className='icon-[mdi--logout]' />
          {t('auth.signOutOthers')}
        </Button>
      ) : null}
      {error ? (
        <Text as='p' color='red' role='alert' size='2'>
          {error}
        </Text>
      ) : null}
    </div>
  )
}
