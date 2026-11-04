<script setup lang="ts">
import type { Participant } from '@osi/owe-yeah-domain';
import type { BrowserSubscription } from '~/sync/db';

// The "Who are you?" sheet: the device picks one of the Trip's Participants as its Claim,
// or uses "Add me" to create a new Participant and Claim it in one step. Closing it ("Just
// looking", or "Cancel" with a Claim) changes nothing. Asked again because someone removed
// the Participant this device was, it says so. With `offerFor` (the Trip's name), it ends
// with the offer of notifications that follows a Claim (#41). Joining a Trip opens it first,
// so it links the privacy notice and the terms too.
const {
  current,
  removed = null,
  offerFor = null,
} = defineProps<{
  participants: readonly Participant[];
  current: Participant | null;
  removed?: Participant | null;
  offerFor?: string | null;
}>();
const emit = defineEmits<{
  claim: [participant: Participant];
  addMe: [name: string];
  subscribed: [subscription: BrowserSubscription];
}>();
const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const title = computed(() => (offerFor ? t('notifications.title') : t('claim.title')));
const description = computed(() => {
  if (offerFor) return t('claim.youAre', { name: current?.name ?? '' });
  return removed ? t('claim.removed', { name: removed.name }) : t('claim.help');
});
</script>

<template>
  <UDrawer v-model:open="open" :title="title" :description="description">
    <template #body>
      <NotificationsOffer
        v-if="offerFor"
        :trip-name="offerFor"
        @subscribed="emit('subscribed', $event)"
        @not-now="open = false"
      />
      <div v-else class="space-y-4">
        <ul v-if="participants.length > 0" class="grid grid-cols-2 gap-2">
          <li v-for="participant in participants" :key="participant.id" class="min-w-0">
            <UButton
              :variant="participant.id === current?.id ? 'soft' : 'outline'"
              color="neutral"
              size="lg"
              block
              class="justify-start"
              @click="emit('claim', participant)"
            >
              <ParticipantAvatar :participant="participant" size="xs" />
              <span class="truncate">{{ participant.name }}</span>
            </UButton>
          </li>
        </ul>
        <ParticipantNameForm
          :label="$t('claim.notListed')"
          :submit-label="$t('claim.addMe')"
          @submit="emit('addMe', $event)"
        />
      </div>
    </template>
    <template v-if="!offerFor" #footer>
      <UButton
        variant="ghost"
        color="neutral"
        block
        :label="current ? $t('claim.cancel') : $t('claim.justLooking')"
        @click="open = false"
      />
      <!-- Closed on the way in (capture), as an open sheet cancels navigation (`useCloseOnBack`). -->
      <LegalLinks class="mt-2" @click.capture="open = false" />
    </template>
  </UDrawer>
</template>
