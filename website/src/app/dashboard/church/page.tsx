import { redirect } from 'next/navigation'

export default function ChurchRedirectPage(): never {
  redirect('/dashboard/account')
}
