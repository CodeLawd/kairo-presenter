import { confirmsDeletion, planAccountDeletion, type PlanMember } from './deletion-plan'

const ME = 'me'
const member = (userId: string, role: PlanMember['role'], status: PlanMember['status'] = 'active'): PlanMember => ({
  userId,
  role,
  status,
})

describe('planAccountDeletion', () => {
  it('deletes a church the user owns alone', () => {
    const plan = planAccountDeletion(ME, [{ id: 'a', name: 'Grace', members: [member(ME, 'owner')] }])
    expect(plan).toEqual({ deleteOrgs: [{ id: 'a', name: 'Grace' }], leaveOrgs: [], blockers: [] })
  })

  it('ignores invited and removed members when deciding whether a church is still used', () => {
    const plan = planAccountDeletion(ME, [
      {
        id: 'a',
        name: 'Grace',
        members: [member(ME, 'owner'), member('x', 'viewer', 'invited'), member('y', 'admin', 'removed')],
      },
    ])
    expect(plan.deleteOrgs).toHaveLength(1)
    expect(plan.blockers).toHaveLength(0)
  })

  it('blocks when the user is the only owner of a church others still use', () => {
    const plan = planAccountDeletion(ME, [
      { id: 'a', name: 'Grace', members: [member(ME, 'owner'), member('x', 'admin'), member('y', 'viewer')] },
    ])
    expect(plan.blockers).toEqual([{ id: 'a', name: 'Grace', otherMembers: 2 }])
    expect(plan.deleteOrgs).toHaveLength(0)
  })

  it('leaves a church that has another active owner', () => {
    const plan = planAccountDeletion(ME, [
      { id: 'a', name: 'Grace', members: [member(ME, 'owner'), member('x', 'owner')] },
    ])
    expect(plan.leaveOrgs).toEqual([{ id: 'a', name: 'Grace' }])
  })

  it('does not count a removed co-owner as an owner', () => {
    const plan = planAccountDeletion(ME, [
      { id: 'a', name: 'Grace', members: [member(ME, 'owner'), member('x', 'owner', 'removed')] },
    ])
    expect(plan.deleteOrgs).toHaveLength(1)
  })

  it('leaves churches where the user is not an owner, however few people remain', () => {
    const plan = planAccountDeletion(ME, [
      { id: 'a', name: 'Grace', members: [member(ME, 'admin'), member('x', 'owner')] },
      { id: 'b', name: 'Hope', members: [member(ME, 'operator')] },
    ])
    expect(plan.leaveOrgs.map((org) => org.id)).toEqual(['a', 'b'])
  })

  it('skips churches where the user has no active membership', () => {
    const plan = planAccountDeletion(ME, [{ id: 'a', name: 'Grace', members: [member(ME, 'owner', 'removed')] }])
    expect(plan).toEqual({ deleteOrgs: [], leaveOrgs: [], blockers: [] })
  })
})

describe('confirmsDeletion', () => {
  const plan = { deleteOrgs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], leaveOrgs: [], blockers: [] }

  it('accepts exactly the churches that will be deleted, in any order', () => {
    expect(confirmsDeletion(plan, ['b', 'a'])).toBe(true)
  })

  it('refuses a missing, extra or empty confirmation', () => {
    expect(confirmsDeletion(plan, ['a'])).toBe(false)
    expect(confirmsDeletion(plan, ['a', 'b', 'c'])).toBe(false)
    expect(confirmsDeletion(plan, [])).toBe(false)
  })

  it('accepts an empty confirmation when nothing will be deleted', () => {
    expect(confirmsDeletion({ deleteOrgs: [], leaveOrgs: [], blockers: [] }, [])).toBe(true)
  })
})
