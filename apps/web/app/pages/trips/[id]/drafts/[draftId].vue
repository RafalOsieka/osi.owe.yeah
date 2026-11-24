<script setup lang="ts">
import { deviceTimeZone, fromMinor, type Rational } from '@osi/owe-yeah-domain';
import {
  PRINTED_TOTAL,
  RECEIPT_SIZE,
  readReceipt,
  usePrototype,
  type Doubt,
} from '~/prototype/photos-drafts';
import { newExpenseDraft } from '~/utils/expense-draft';

// PROTOTYPE (#282): a Draft opened. Before it is read (or when it couldn't be), its Photo with
// what is happening and what can be done: type it by hand instead, try again, discard. Once
// read, the new-Receipt form pre-filled, with the doubtful lines marked, the printed total to
// check against, and the Photo at hand, in three variants:
// A: a peek strip of the Photo under the header, following the open line; tap to enlarge.
// B: a floating thumbnail over the form; each doubtful line shows its strip of the Photo.
// C: Photo | Receipt tabs; the Photo marks the doubtful lines, tap one to open it.
definePageMeta({ viewTransition: { toTypes: ['forward'], fromTypes: ['back'] } });

const { trip, claim, lastCurrency } = useOpenTrip();
const proto = usePrototype();
const route = useRoute();
const back = useBack();
const { locale } = useI18n();
const status = useDraftStatus();
const tripPage = computed(() => `/trips/${trip.value.id}`);
const draft = computed(() => proto.state.drafts.find(({ id }) => id === route.params.draftId));
const variant = computed(() => proto.variant('draft'));

// What was read, fresh each time the Draft opens: Cancel leaves it as read.
const read = readReceipt(trip.value.participants);
const doubts = ref<Record<string, Doubt>>({ ...read.doubts });
const seed = (() => {
  const start = newExpenseDraft(trip.value, {
    now: draft.value?.scannedAt ?? new Date(),
    zone: deviceTimeZone(),
    claimId: claim.value?.id ?? null,
    lastCurrency: lastCurrency.value,
  });
  return {
    ...start,
    id: draft.value?.id ?? start.id,
    title: 'Sklep spożywczy',
    currency: 'PLN',
    lineItems: read.lineItems,
  };
})();
const openLine = ref<string | null>(null);
const viewing = ref<number | null>(null);
const pane = ref<'photo' | 'receipt'>('receipt');
const peekOpen = ref(false);
const peek = useTemplateRef<HTMLElement>('peek');
const discarding = ref(false);
const scanner = useTemplateRef<{ startScan: () => void }>('scanner');

const printed = fromMinor(PRINTED_TOTAL, 'PLN');
const money = (amount: Rational) => formatMoney(amount, 'PLN', locale.value);
const matches = (total: Rational | null) =>
  !!total && total.numerator * printed.denominator === printed.numerator * total.denominator;

// A: the peek strip follows the open line to where it sits on the Photo.
watch(openLine, async (key) => {
  if (!key || !peek.value) return;
  await nextTick();
  const image = peek.value.querySelector('img');
  if (!image) return;
  const y = ((read.positions[key] ?? 0) / RECEIPT_SIZE.height) * image.clientHeight;
  peek.value.scrollTo({ top: y - 24, behavior: 'smooth' });
});

async function showLine(key: string): Promise<void> {
  pane.value = 'receipt';
  openLine.value = key;
  await nextTick();
  document.getElementById(`line-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function discard(): void {
  if (!draft.value) return;
  proto.discard(draft.value.id);
  discarding.value = false;
  void back(tripPage.value);
}

function byHand(): void {
  if (!draft.value) return;
  proto.state.carry = draft.value.photo;
  proto.discard(draft.value.id);
  void navigateTo(`${tripPage.value}/expenses/new`, { replace: true });
}

function scanAgain(): void {
  if (!draft.value) return;
  proto.discard(draft.value.id);
  scanner.value?.startScan();
}

function saved(): void {
  if (draft.value) proto.discard(draft.value.id);
}

const scannedBy = computed(() => (draft.value ? status(draft.value).by : ''));
</script>

<template>
  <div>
    <PrototypeSwitcher
      v-if="draft?.state === 'ready'"
      screen="draft"
      :names="{ A: 'Peek strip', B: 'Floating thumbnail + crops', C: 'Photo | Receipt tabs' }"
    />
    <PrototypeTabDrafts ref="scanner" place="none" />

    <!-- Read: the pre-filled Receipt form. -->
    <ExpenseForm
      v-if="draft?.state === 'ready'"
      v-model:doubts="doubts"
      v-model:open-line="openLine"
      :parent="tripPage"
      :seed="seed"
      :seed-photos="[draft.photo]"
      heading="Check the Receipt"
      :form-hidden="variant === 'C' && pane === 'photo'"
      :doubt-style="variant === 'B' ? 'crop' : 'note'"
      draft
      @saved="saved"
    >
      <template #top="{ total }">
        <!-- A: the peek strip. -->
        <div
          v-if="variant === 'A'"
          class="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-5 -mx-4 -mt-4 mb-4 bg-black"
        >
          <div
            ref="peek"
            class="overflow-y-auto transition-[height]"
            :class="peekOpen ? 'h-[55dvh]' : 'h-28'"
          >
            <img :src="draft.photo.url" alt="The Receipt's Photo" class="w-full" />
          </div>
          <div class="absolute end-2 bottom-2 flex gap-2">
            <UButton
              size="sm"
              color="neutral"
              variant="solid"
              :icon="peekOpen ? 'i-lucide-chevrons-up' : 'i-lucide-chevrons-down'"
              :label="peekOpen ? 'Smaller' : 'Larger'"
              @click="peekOpen = !peekOpen"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="solid"
              icon="i-lucide-maximize-2"
              aria-label="Full screen"
              @click="viewing = 0"
            />
          </div>
        </div>

        <!-- B: the floating thumbnail. -->
        <button
          v-if="variant === 'B'"
          type="button"
          class="fixed end-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 h-28 w-20 cursor-pointer overflow-hidden rounded-xl shadow-xl ring-2 ring-default"
          aria-label="The Receipt's Photo"
          @click="viewing = 0"
        >
          <img :src="draft.photo.url" alt="" class="size-full object-cover object-top" />
        </button>

        <!-- C: Photo | Receipt. -->
        <div
          v-if="variant === 'C'"
          class="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-5 -mx-4 -mt-4 mb-4 bg-canvas px-4 py-2"
        >
          <SegmentedControl
            v-model="pane"
            label="Show"
            :options="[
              { value: 'receipt', label: 'Line items' },
              { value: 'photo', label: 'Photo' },
            ]"
            class="w-full"
          />
        </div>
        <div v-if="variant === 'C' && pane === 'photo'" class="relative -mx-4">
          <img :src="draft.photo.url" alt="The Receipt's Photo" class="w-full" />
          <button
            v-for="(doubt, key) in doubts"
            :key="key"
            type="button"
            class="absolute inset-x-[12%] cursor-pointer rounded-md bg-warning/15 ring-2 ring-warning"
            :style="{
              top: `${((doubt.y - 30) / RECEIPT_SIZE.height) * 100}%`,
              height: `${(80 / RECEIPT_SIZE.height) * 100}%`,
            }"
            :aria-label="doubt.text"
            @click="showLine(String(key))"
          >
            <span
              class="absolute -top-2.5 -end-2.5 grid size-6 place-items-center rounded-full bg-warning text-inverted"
            >
              <UIcon name="i-lucide-scan-eye" class="size-3.5" />
            </span>
          </button>
        </div>

        <!-- Every variant: what to check, against the printed total. -->
        <div v-if="variant !== 'C' || pane === 'receipt'" class="mb-5">
          <AttentionNote
            v-if="Object.keys(doubts).length > 0 || !matches(total)"
            icon="i-lucide-scan-eye"
          >
            <p class="font-medium">Read from the Photo. Check before saving.</p>
            <p v-if="total && !matches(total)" class="text-toned tabular-nums">
              The Line items come to {{ money(total) }}, the Receipt says {{ money(printed) }}.
            </p>
            <template v-if="Object.keys(doubts).length > 0" #action>
              <button
                v-for="(doubt, key) in doubts"
                :key="key"
                type="button"
                class="-my-1.5 flex min-h-10 w-full cursor-pointer items-center gap-1 text-start font-medium text-warning"
                @click="showLine(String(key))"
              >
                <span class="min-w-0 flex-1">
                  {{ read.lineItems.find((line) => line.key === key)?.name }}: {{ doubt.text }}
                </span>
                <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0" />
              </button>
            </template>
          </AttentionNote>
          <p v-else class="flex items-center gap-1.5 px-1 text-sm text-success">
            <UIcon name="i-lucide-check" class="size-4" />
            Matches the Receipt's printed total, {{ money(printed) }}.
          </p>
        </div>
      </template>

      <template #end>
        <div class="card divide-y divide-default overflow-hidden">
          <p class="flex items-center gap-3 px-4 py-3 text-sm text-muted">
            <UIcon name="i-lucide-scan-line" class="size-5 shrink-0" />
            {{ scannedBy }}
          </p>
          <button
            type="button"
            class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-start text-error transition-colors hover:bg-error/5"
            @click="discarding = true"
          >
            <UIcon name="i-lucide-trash-2" class="size-5 shrink-0" />
            Discard Draft
          </button>
        </div>
      </template>
    </ExpenseForm>

    <!-- Not read (yet): the Photo and what can be done. -->
    <NuxtLayout v-else-if="draft" name="form" title="Draft" :parent="tripPage">
      <div class="space-y-5">
        <button
          type="button"
          class="mx-auto block h-72 w-52 cursor-pointer"
          aria-label="The Receipt's Photo"
          @click="viewing = 0"
        >
          <PrototypePhotoThumb :photo="draft.photo" class="size-full rounded-xl" />
        </button>

        <div v-if="draft.state === 'upload' || draft.state === 'reading'" class="card p-4">
          <p class="flex items-center gap-2 font-semibold text-highlighted">
            <UIcon
              :name="status(draft).icon"
              class="size-5 text-muted"
              :class="status(draft).iconClass"
            />
            {{ status(draft).label }}
          </p>
          <p class="mt-1 text-sm text-muted">
            {{
              draft.state === 'upload'
                ? "It's on this device. Once you're back online it uploads and is read."
                : 'This can take a few minutes. Keep using the app: it shows on the Expenses tab when it is ready to check.'
            }}
          </p>
        </div>
        <AttentionNote v-if="draft.state === 'failed'" icon="i-lucide-scan-eye">
          <p class="font-medium">Couldn't read this Receipt</p>
          <p class="text-toned">
            The Photo may be blurry, dark or cut off. Take it again, or type the Receipt in
            yourself.
          </p>
        </AttentionNote>
        <AttentionNote v-if="draft.state === 'refused'">
          <p class="font-medium">Couldn't upload. It's only on this device.</p>
          <p class="text-toned">{{ draft.reason }}</p>
          <template #action>
            <UButton
              label="Try again"
              color="neutral"
              variant="outline"
              @click="proto.retry(draft)"
            />
          </template>
        </AttentionNote>

        <div class="card divide-y divide-default overflow-hidden">
          <p class="flex items-center gap-3 px-4 py-3 text-sm text-muted">
            <UIcon name="i-lucide-scan-line" class="size-5 shrink-0" />
            {{ scannedBy }}
          </p>
          <button
            v-if="draft.state === 'failed'"
            type="button"
            class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-start font-medium text-primary transition-colors hover:bg-elevated/60"
            @click="scanAgain"
          >
            <UIcon name="i-lucide-camera" class="size-5 shrink-0" />
            Take the Photo again
          </button>
          <button
            type="button"
            class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-3 text-start text-error transition-colors hover:bg-error/5"
            @click="discarding = true"
          >
            <UIcon name="i-lucide-trash-2" class="size-5 shrink-0" />
            Discard Draft
          </button>
        </div>
      </div>

      <template #action>
        <UButton
          block
          size="xl"
          :color="draft.state === 'failed' ? 'primary' : 'neutral'"
          :variant="draft.state === 'failed' ? 'solid' : 'outline'"
          icon="i-lucide-pencil-line"
          :label="draft.state === 'failed' ? 'Type it by hand' : 'Type it by hand instead'"
          @click="byHand"
        />
      </template>
    </NuxtLayout>
    <UEmpty v-else icon="i-lucide-scan-line" variant="naked" title="This Draft is gone" />

    <PrototypePhotoViewer v-if="draft" v-model="viewing" :photos="[draft.photo]" />

    <UDrawer
      v-model:open="discarding"
      title="Discard this Draft?"
      description="Its Photo goes with it, for everyone in the Trip. This can't be undone."
      :ui="{ footer: 'pb-2' }"
    >
      <template #footer>
        <UButton
          color="error"
          block
          size="xl"
          icon="i-lucide-trash-2"
          label="Discard Draft"
          @click="discard"
        />
        <UButton
          color="neutral"
          variant="outline"
          block
          size="xl"
          label="Keep it"
          @click="discarding = false"
        />
      </template>
    </UDrawer>
  </div>
</template>
