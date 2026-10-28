<template>
  <div class="min-h-dvh">
    <UHeader :title="$t('app.title')" to="/" :toggle="false">
      <template #right>
        <UColorModeButton />
      </template>
    </UHeader>
    <UMain>
      <UContainer>
        <slot />
      </UContainer>
    </UMain>
  </div>
</template>
