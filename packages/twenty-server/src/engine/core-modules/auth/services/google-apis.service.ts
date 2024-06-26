import { Injectable, Inject } from '@nestjs/common';

import { EntityManager } from 'typeorm';
import { v4 } from 'uuid';

import { TypeORMService } from 'src/database/typeorm/typeorm.service';
import { EnvironmentService } from 'src/engine/integrations/environment/environment.service';
import { MessageQueue } from 'src/engine/integrations/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/integrations/message-queue/services/message-queue.service';
import { DataSourceService } from 'src/engine/metadata-modules/data-source/data-source.service';
import { InjectObjectMetadataRepository } from 'src/engine/object-metadata-repository/object-metadata-repository.decorator';
import {
  GoogleCalendarSyncJobData,
  GoogleCalendarSyncJob,
} from 'src/modules/calendar/jobs/google-calendar-sync.job';
import { CalendarChannelRepository } from 'src/modules/calendar/repositories/calendar-channel.repository';
import {
  CalendarChannelWorkspaceEntity,
  CalendarChannelVisibility,
} from 'src/modules/calendar/standard-objects/calendar-channel.workspace-entity';
import { ConnectedAccountRepository } from 'src/modules/connected-account/repositories/connected-account.repository';
import {
  ConnectedAccountWorkspaceEntity,
  ConnectedAccountProvider,
} from 'src/modules/connected-account/standard-objects/connected-account.workspace-entity';
import { MessageChannelRepository } from 'src/modules/messaging/common/repositories/message-channel.repository';
import {
  MessageChannelWorkspaceEntity,
  MessageChannelType,
  MessageChannelVisibility,
} from 'src/modules/messaging/common/standard-objects/message-channel.workspace-entity';
import {
  MessagingMessageListFetchJob,
  MessagingMessageListFetchJobData,
} from 'src/modules/messaging/message-import-manager/jobs/messaging-message-list-fetch.job';

@Injectable()
export class GoogleAPIsService {
  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly typeORMService: TypeORMService,
    @Inject(MessageQueue.messagingQueue)
    private readonly messageQueueService: MessageQueueService,
    @Inject(MessageQueue.calendarQueue)
    private readonly calendarQueueService: MessageQueueService,
    private readonly environmentService: EnvironmentService,
    @InjectObjectMetadataRepository(ConnectedAccountWorkspaceEntity)
    private readonly connectedAccountRepository: ConnectedAccountRepository,
    @InjectObjectMetadataRepository(MessageChannelWorkspaceEntity)
    private readonly messageChannelRepository: MessageChannelRepository,
    @InjectObjectMetadataRepository(CalendarChannelWorkspaceEntity)
    private readonly calendarChannelRepository: CalendarChannelRepository,
  ) {}

  async refreshGoogleRefreshToken(input: {
    handle: string;
    workspaceMemberId: string;
    workspaceId: string;
    accessToken: string;
    refreshToken: string;
    calendarVisibility: CalendarChannelVisibility | undefined;
    messageVisibility: MessageChannelVisibility | undefined;
  }) {
    const {
      handle,
      workspaceId,
      workspaceMemberId,
      calendarVisibility,
      messageVisibility,
    } = input;

    const dataSourceMetadata =
      await this.dataSourceService.getLastDataSourceMetadataFromWorkspaceIdOrFail(
        workspaceId,
      );

    const workspaceDataSource =
      await this.typeORMService.connectToDataSource(dataSourceMetadata);

    const isCalendarEnabled = this.environmentService.get(
      'CALENDAR_PROVIDER_GOOGLE_ENABLED',
    );

    const connectedAccounts =
      await this.connectedAccountRepository.getAllByHandleAndWorkspaceMemberId(
        handle,
        workspaceMemberId,
        workspaceId,
      );

    const existingAccountId = connectedAccounts?.[0]?.id;
    const newOrExistingConnectedAccountId = existingAccountId ?? v4();

    await workspaceDataSource?.transaction(async (manager: EntityManager) => {
      if (!existingAccountId) {
        await this.connectedAccountRepository.create(
          {
            id: newOrExistingConnectedAccountId,
            handle,
            provider: ConnectedAccountProvider.GOOGLE,
            accessToken: input.accessToken,
            refreshToken: input.refreshToken,
            accountOwnerId: workspaceMemberId,
          },
          workspaceId,
          manager,
        );

        await this.messageChannelRepository.create(
          {
            id: v4(),
            connectedAccountId: newOrExistingConnectedAccountId,
            type: MessageChannelType.EMAIL,
            handle,
            visibility:
              messageVisibility || MessageChannelVisibility.SHARE_EVERYTHING,
          },
          workspaceId,
          manager,
        );

        if (isCalendarEnabled) {
          await this.calendarChannelRepository.create(
            {
              id: v4(),
              connectedAccountId: newOrExistingConnectedAccountId,
              handle,
              visibility:
                calendarVisibility ||
                CalendarChannelVisibility.SHARE_EVERYTHING,
            },
            workspaceId,
            manager,
          );
        }
      } else {
        await this.connectedAccountRepository.updateAccessTokenAndRefreshToken(
          input.accessToken,
          input.refreshToken,
          newOrExistingConnectedAccountId,
          workspaceId,
          manager,
        );

        await this.messageChannelRepository.resetSync(
          newOrExistingConnectedAccountId,
          workspaceId,
          manager,
        );
      }
    });

    await this.enqueueSyncJobs(
      newOrExistingConnectedAccountId,
      workspaceId,
      isCalendarEnabled,
    );
  }

  private async enqueueSyncJobs(
    connectedAccountId: string,
    workspaceId: string,
    isCalendarEnabled: boolean,
  ) {
    if (this.environmentService.get('MESSAGING_PROVIDER_GMAIL_ENABLED')) {
      await this.messageQueueService.add<MessagingMessageListFetchJobData>(
        MessagingMessageListFetchJob.name,
        {
          workspaceId,
          connectedAccountId,
        },
      );
    }

    if (
      this.environmentService.get('CALENDAR_PROVIDER_GOOGLE_ENABLED') &&
      isCalendarEnabled
    ) {
      await this.calendarQueueService.add<GoogleCalendarSyncJobData>(
        GoogleCalendarSyncJob.name,
        {
          workspaceId,
          connectedAccountId,
        },
        {
          retryLimit: 2,
        },
      );
    }
  }
}
