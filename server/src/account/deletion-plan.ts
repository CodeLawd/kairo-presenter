import type { OrgRole } from '../orgs/schemas/membership.schema'

export interface PlanMember {
  userId: string
  role: OrgRole
  status: 'active' | 'invited' | 'removed'
}

export interface PlanOrg {
  id: string
  name: string
  /** Every membership row of the org, the deleting user's included. */
  members: PlanMember[]
}

export interface DeletionPlan {
  /** Churches where the user is the only person left — deleted with the account. */
  deleteOrgs: { id: string; name: string }[]
  /** Churches that carry on without the user; only the membership goes. */
  leaveOrgs: { id: string; name: string }[]
  /**
   * Churches the user is the sole owner of while others still belong to them.
   * Deleting would take a church away from people who did not ask, and leaving
   * would orphan it, so the account cannot be deleted until ownership moves.
   */
  blockers: { id: string; name: string; otherMembers: number }[]
}

/**
 * Decides what happens to each church when someone deletes their account.
 *
 * Pure so the rules can be read and tested apart from Mongo: only an active
 * owner counts as an owner, and only active members count as people a church
 * would be taken away from.
 */
export function planAccountDeletion(userId: string, orgs: readonly PlanOrg[]): DeletionPlan {
  const plan: DeletionPlan = { deleteOrgs: [], leaveOrgs: [], blockers: [] }
  for (const org of orgs) {
    const mine = org.members.find((member) => member.userId === userId && member.status === 'active')
    if (!mine) continue
    const others = org.members.filter(
      (member) => member.userId !== userId && member.status === 'active',
    )
    const otherOwner = others.some((member) => member.role === 'owner')

    if (mine.role !== 'owner' || otherOwner) {
      plan.leaveOrgs.push({ id: org.id, name: org.name })
    } else if (others.length === 0) {
      plan.deleteOrgs.push({ id: org.id, name: org.name })
    } else {
      plan.blockers.push({ id: org.id, name: org.name, otherMembers: others.length })
    }
  }
  return plan
}

/** The client must name exactly the churches that will go — no more, no fewer. */
export function confirmsDeletion(plan: DeletionPlan, confirmedOrgIds: readonly string[]): boolean {
  const expected = new Set(plan.deleteOrgs.map((org) => org.id))
  const given = new Set(confirmedOrgIds)
  if (expected.size !== given.size) return false
  for (const id of expected) if (!given.has(id)) return false
  return true
}
