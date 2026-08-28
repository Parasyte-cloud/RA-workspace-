import { lazy } from 'react'
import './lazy-routes.css'

export const MarketingTeamWorkspace = lazy(
  () =>
    import('./modules/MarketingTeamWorkspace').then(
      module => ({
        default: module.MarketingTeamWorkspace
      })
    )
)

export const ParasyteLinux = lazy(
  () => import('./modules/ParasyteLinux')
)

export const BrandLibrary = lazy(
  () => import('./modules/BrandLibrary')
)

export const ParasyteBrowser = lazy(
  () => import('./modules/ParasyteBrowser')
)

export const SupportTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.SupportTeamWorkspace
      })
    )
)

export const OperationsTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.OperationsTeamWorkspace
      })
    )
)

export const PeopleTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.PeopleTeamWorkspace
      })
    )
)

export const EngineeringTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.EngineeringTeamWorkspace
      })
    )
)

export const FinanceTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.FinanceTeamWorkspace
      })
    )
)

export const PartnershipsTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.PartnershipsTeamWorkspace
      })
    )
)

export const LegalTeamWorkspace = lazy(
  () =>
    import('./modules/DepartmentTeamWorkspace').then(
      module => ({
        default: module.LegalTeamWorkspace
      })
    )
)

export const SupportModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.SupportModule
      })
    )
)

export const PeopleModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.PeopleModule
      })
    )
)

export const OperationsModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.OperationsModule
      })
    )
)

export const FinanceModule = lazy(
  () =>
    import('./modules/BusinessModules').then(
      module => ({
        default: module.FinanceModule
      })
    )
)

export const PartnershipsModule = lazy(
  () =>
    import('./modules/BusinessModules').then(
      module => ({
        default: module.PartnershipsModule
      })
    )
)

export const LegalModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.LegalModule
      })
    )
)

export const MailModule = lazy(
  () =>
    import('./modules/MailModule').then(
      module => ({
        default: module.MailModule
      })
    )
)

export const CRMModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.CRMModule
      })
    )
)


export const AdminModule = lazy(
  () =>
    import('./modules/CoreModules').then(
      module => ({
        default: module.AdminModule
      })
    )
)


export const SocialModule = lazy(
  () =>
    import('./modules/SocialModule').then(
      module => ({
        default: module.SocialModule
      })
    )
)


export const ProfileModule = lazy(
  () =>
    import('./modules/ProfileModule').then(
      module => ({
        default: module.ProfileModule
      })
    )
)


export const WorkDesk = lazy(
  () =>
    import('./modules/WorkDesk').then(
      module => ({
        default: module.WorkDesk
      })
    )
)


export const AnnouncementsModule = lazy(
  () =>
    import('./modules/Phase2Modules').then(
      module => ({
        default: module.AnnouncementsModule
      })
    )
)


export const CalendarModule = lazy(
  () =>
    import('./modules/Phase2Modules').then(
      module => ({
        default: module.CalendarModule
      })
    )
)


export const KnowledgeBaseModule = lazy(
  () =>
    import('./modules/Phase2Modules').then(
      module => ({
        default: module.KnowledgeBaseModule
      })
    )
)


export const CompanyFilesModule = lazy(
  () =>
    import('./modules/Phase2Modules').then(
      module => ({
        default: module.CompanyFilesModule
      })
    )
)


export const OverviewMetrics = lazy(
  () =>
    import('./modules/OverviewMetrics').then(
      module => ({
        default: module.OverviewMetrics
      })
    )
)


export const HeadshotGallery = lazy(
  () =>
    import('./modules/HeadshotGallery').then(
      module => ({
        default: module.HeadshotGallery
      })
    )
)


export const ApplicationsHub = lazy(
  () => import('./modules/ApplicationsHub')
)


export const AppearanceSettings = lazy(
  () =>
    import('./modules/AppearanceSettings').then(
      module => ({
        default: module.AppearanceSettings
      })
    )
)

