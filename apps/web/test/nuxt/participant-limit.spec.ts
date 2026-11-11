import { PARTICIPANT_LIMIT, type Participant } from '@osi/owe-yeah-domain';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import NewTrip from '../../app/pages/trips/new.vue';
import Settings from '../../app/pages/trips/[id]/settings.vue';

// The Trip's live Participants, as each test sets them.
const participants = ref<Participant[]>([]);

function everyone(count: number): Participant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `019a2b3c-4d5e-7f00-8a1b-${String(index).padStart(12, '0')}`,
    name: `Participant ${index + 1}`,
  }));
}

// The Settings tab and its layout read the open Trip only.
mockNuxtImport('useOpenTrip', () => () => ({
  trip: computed(() => ({
    id: '019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b',
    name: 'Croatia 2026',
    currency: 'EUR',
    participants: participants.value,
    expenses: [],
  })),
  claim: ref(null),
  everyone: participants,
  unsynced: ref(0),
  notices: ref([]),
  notifications: ref({ subscription: null, offered: false, registered: null }),
  sync: async () => {},
  askWhoYouAre: () => {},
  invite: async () => {},
  dismissNotice: async () => {},
  addParticipant: async () => {},
  removeParticipant: async () => 0,
  forget: async () => {},
}));

describe('New Trip', () => {
  it('offers no more fields once "Your name" and the others make 100 Participants', async () => {
    const page = await mountSuspended(NewTrip);
    const addAnother = () =>
      page.findAll('button').find((button) => button.text() === 'Add another')!;

    // "Your name" and one other field to start with.
    for (let count = 2; count < PARTICIPANT_LIMIT; count++) {
      await addAnother().trigger('click');
    }

    expect(addAnother().attributes('disabled')).toBeDefined();
    expect(page.text()).toContain('A Trip can have at most 100 Participants.');
  });
});

describe('Settings', () => {
  const addParticipant = async (count: number) => {
    participants.value = everyone(count);
    const page = await mountSuspended(Settings);
    return { page, button: page.findAll('button').find((b) => b.text() === 'Add Participant')! };
  };

  it('adds Participants until the Trip has 100', async () => {
    const { page, button } = await addParticipant(PARTICIPANT_LIMIT - 1);

    expect(button.attributes('disabled')).toBeUndefined();
    expect(page.text()).not.toContain('A Trip can have at most 100 Participants.');
  });

  it('offers no Add Participant once the Trip has 100, saying why', async () => {
    const { page, button } = await addParticipant(PARTICIPANT_LIMIT);

    expect(button.attributes('disabled')).toBeDefined();
    expect(page.text()).toContain('A Trip can have at most 100 Participants.');
  });
});
