import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Organization, OrganizationDocument } from './schemas/organization.schema'
import { Membership, MembershipDocument, OrgRole } from './schemas/membership.schema'

@Injectable()
export class OrgsService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
  ) {}

  /** Creates the org and its owner membership together — one is useless alone. */
  async createWithOwner(input: {
    name: string
    ownerUserId: Types.ObjectId
    timezone?: string
  }): Promise<OrganizationDocument> {
    const org = await this.orgs.create({
      name: input.name.trim(),
      slug: await this.uniqueSlug(input.name),
      timezone: input.timezone ?? '',
      ownerUserId: input.ownerUserId,
      seatsUsed: 1,
    })
    await this.memberships.create({
      orgId: org._id,
      userId: input.ownerUserId,
      role: 'owner',
      status: 'active',
    })
    return org
  }

  async findById(orgId: Types.ObjectId | string): Promise<OrganizationDocument | null> {
    return this.orgs.findById(orgId).exec()
  }

  async requireById(orgId: Types.ObjectId | string): Promise<OrganizationDocument> {
    const org = await this.findById(orgId)
    if (!org) throw new NotFoundException('Organization not found')
    return org
  }

  /** The authorization primitive: what this user is inside this org, if anything. */
  async membershipOf(
    userId: Types.ObjectId | string,
    orgId: Types.ObjectId | string,
  ): Promise<MembershipDocument | null> {
    return this.memberships.findOne({ userId, orgId, status: 'active' }).exec()
  }

  async membershipsOf(userId: Types.ObjectId | string): Promise<MembershipDocument[]> {
    return this.memberships.find({ userId, status: 'active' }).exec()
  }

  async listMembers(orgId: Types.ObjectId | string): Promise<MembershipDocument[]> {
    return this.memberships.find({ orgId, status: { $ne: 'removed' } }).exec()
  }

  async updateProfile(
    orgId: Types.ObjectId | string,
    patch: { name?: string; timezone?: string; serviceTimes?: unknown[] },
  ): Promise<OrganizationDocument> {
    const update: Record<string, unknown> = {}
    if (patch.name !== undefined) update.name = patch.name.trim()
    if (patch.timezone !== undefined) update.timezone = patch.timezone.trim()
    if (patch.serviceTimes !== undefined) update.serviceTimes = patch.serviceTimes
    const org = await this.orgs.findByIdAndUpdate(orgId, { $set: update }, { new: true }).exec()
    if (!org) throw new NotFoundException('Organization not found')
    return org
  }

  async setRole(
    orgId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    role: OrgRole,
  ): Promise<void> {
    await this.memberships.updateOne({ orgId, userId }, { $set: { role } })
  }

  /**
   * Slugs are cosmetic but unique, so a second "Grace Chapel" gets a suffix
   * rather than a duplicate-key error thrown at a new user mid-signup.
   */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'church'

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
      const taken = await this.orgs.exists({ slug: candidate })
      if (!taken) return candidate
    }
    return `${base}-${Date.now().toString(36)}`
  }
}
