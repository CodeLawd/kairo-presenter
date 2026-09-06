import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Organization, OrganizationSchema } from './schemas/organization.schema'
import { Membership, MembershipSchema } from './schemas/membership.schema'
import { OrgSecrets, OrgSecretsSchema } from './schemas/org-secrets.schema'
import { OrgsService } from './orgs.service'
import { OrgSecretsService } from './org-secrets.service'
import { OrgsController } from './orgs.controller'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: OrgSecrets.name, schema: OrgSecretsSchema },
    ]),
  ],
  controllers: [OrgsController],
  providers: [OrgsService, OrgSecretsService],
  exports: [OrgsService, OrgSecretsService, MongooseModule],
})
export class OrgsModule {}
