<template>
  <nut-form-item :prop="prop">
    <template #label>
      <span class="image-fit-label">
        {{ labelText }}
        <nut-icon
          name="tips"
          size="14"
          role="button"
          :aria-label="$t(`imageFit.tips.title`)"
          @click.stop="openTips"
        />
      </span>
    </template>
    <nut-input
      :model-value="currentText"
      class="nut-input-text"
      :border="false"
      input-align="right"
      readonly
      right-icon="rect-right"
      @click="openPicker"
      @click-right-icon="openPicker"
    />
  </nut-form-item>
  <DesktopPicker
    v-model="pickerValue"
    v-model:visible="showPicker"
    :columns="columns"
    :title="labelText"
    :cancel-text="$t(`editorPage.subConfig.sourceNamePicker.cancel`)"
    :ok-text="$t(`editorPage.subConfig.sourceNamePicker.confirm`)"
    @confirm="confirm"
  />
</template>

<script setup lang="ts">
import { Dialog } from "@nutui/nutui";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import DesktopPicker from "@/components/DesktopPicker.vue";
import { IMAGE_FIT_OPTIONS, isImageFit, type ImageFit } from "@/utils/iconFit";

const INHERIT_IMAGE_FIT = "__inherit__";
type ImageFitPickerValue = ImageFit | typeof INHERIT_IMAGE_FIT;

const props = withDefaults(
  defineProps<{
    modelValue?: ImageFit | string | null;
    fallbackValue?: ImageFit | string | null;
    label?: string;
    prop?: string;
  }>(),
  {
    label: "",
    prop: "iconFit",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: ImageFit | undefined): void;
  (event: "change", value: ImageFit | undefined): void;
}>();

const { t } = useI18n();
const showPicker = ref(false);
const labelText = computed(() => props.label || t("editorPage.subConfig.basic.iconFit.label"));
const currentPickerValue = computed<ImageFitPickerValue>(() => {
  return isImageFit(props.modelValue) ? props.modelValue : INHERIT_IMAGE_FIT;
});
const currentText = computed(() => {
  return currentPickerValue.value === INHERIT_IMAGE_FIT
    ? t("imageFit.inherit")
    : t(`imageFit.${currentPickerValue.value}`);
});
const columns = computed(() => {
  return [
    {
      text: t("imageFit.inherit"),
      value: INHERIT_IMAGE_FIT,
    },
    ...IMAGE_FIT_OPTIONS.map((value) => ({
      text: t(`imageFit.${value}`),
      value,
    })),
  ];
});
const pickerValue = ref<ImageFitPickerValue[]>([currentPickerValue.value]);
watch(currentPickerValue, (value) => {
  if (!showPicker.value) pickerValue.value = [value];
});
watch(showPicker, (visible) => {
  if (visible) pickerValue.value = [currentPickerValue.value];
});
const openPicker = () => {
  pickerValue.value = [currentPickerValue.value];
  showPicker.value = true;
};
const confirm = ({ selectedValue }: { selectedValue?: unknown[] }) => {
  const selected = selectedValue?.[0];
  const next = isImageFit(selected) ? selected : undefined;
  emit("update:modelValue", next);
  emit("change", next);
};
const openTips = () => {
  Dialog({
    title: t("imageFit.tips.title"),
    content: t("imageFit.tips.content"),
    popClass: "auto-dialog image-fit-tips-dialog",
    noCancelBtn: true,
    okText: t("imageFit.tips.close"),
    closeOnClickOverlay: true,
    closeOnPopstate: true,
  });
};
</script>

<style scoped lang="scss">
.image-fit-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  :deep(.nut-icon-tips) {
    color: var(--second-text-color);
  }
}
</style>
