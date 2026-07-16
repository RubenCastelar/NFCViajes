import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_NAME = "nfc-travel-memories";
const DB_VERSION = 1;
const STORE_NAME = "trips";
const SUPABASE_URL = "https://mwsbhujdegfzaiotpofm.supabase.co";
const SUPABASE_KEY = "sb_publishable_VslYOaepgNFf8hZ7REkHMA_nyAaYcZA";
const STORAGE_BUCKET = "trip-images";
const MIGRATION_MARKER_KEY = `nfc-travel-memories:migrated:${SUPABASE_URL}`;

const state = {
  trips: [],
  draggedTripId: null,
  dragStartOrder: null,
  lastPreviewSwap: "",
  suppressPreviewClick: false,
  mode: "local",
  remoteAvailable: false,
  localTripCount: 0,
  statusMessage: "",
  remoteErrorMessage: "",
  isBusy: false,
};

const elements = {
  tripView: document.querySelector("#trip-view"),
  emptyState: document.querySelector("#empty-state"),
  topPreviewRail: document.querySelector("#top-preview-rail"),
  modal: document.querySelector("#trip-modal"),
  openCreateModal: document.querySelector("#open-create-modal"),
  closeModal: document.querySelector("#close-modal"),
  tripForm: document.querySelector("#trip-form"),
  tripImages: document.querySelector("#trip-images"),
  previewGrid: document.querySelector("#preview-grid"),
  previewCardTemplate: document.querySelector("#preview-card-template"),
  galleryTemplate: document.querySelector("#gallery-template"),
  migrateLocalData: document.querySelector("#migrate-local-data"),
  refreshTrips: document.querySelector("#refresh-trips"),
  syncStatus: document.querySelector("#sync-status"),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

let db;

init().catch((error) => {
  console.error(error);
  alert("No se pudo iniciar la app.");
});

async function init() {
  db = await openDatabase();
  bindEvents();

  const localTrips = await getLocalTrips();
  state.localTripCount = localTrips.length;

  const remoteTrips = await tryLoadRemoteTrips();
  if (remoteTrips) {
    state.mode = "remote";
    state.remoteAvailable = true;
    state.trips = remoteTrips;

    if (
      remoteTrips.length === 0 &&
      localTrips.length > 0 &&
      !window.localStorage.getItem(MIGRATION_MARKER_KEY)
    ) {
      await migrateLocalTripsToSupabase(localTrips, true);
    } else {
      setStatusMessage(buildStatusMessage());
    }
  } else {
    state.mode = "local";
    state.remoteAvailable = false;
    state.trips = await migrateStoredHeicImages(localTrips);
    setStatusMessage(buildStatusMessage());
  }

  render();
}

function bindEvents() {
  elements.openCreateModal.addEventListener("click", () => {
    elements.modal.showModal();
  });

  elements.closeModal.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) {
      closeModal();
    }
  });

  elements.tripImages.addEventListener("change", handlePreview);
  elements.tripForm.addEventListener("submit", handleTripSubmit);
  elements.migrateLocalData.addEventListener("click", async () => {
    const localTrips = await getLocalTrips();
    await migrateLocalTripsToSupabase(localTrips, false);
  });
  elements.refreshTrips.addEventListener("click", async () => {
    if (!state.remoteAvailable || state.isBusy) {
      return;
    }

    await refreshRemoteTrips("Contenido recargado desde Supabase.");
  });
  window.addEventListener("hashchange", render);
}

function closeModal() {
  elements.tripForm.reset();
  elements.previewGrid.innerHTML = "";
  elements.modal.close();
}

async function handleTripSubmit(event) {
  event.preventDefault();

  if (state.isBusy) {
    return;
  }

  const name = document.querySelector("#trip-name").value.trim();
  const description = document.querySelector("#trip-description").value.trim();
  const files = [...elements.tripImages.files].filter(isSupportedImageFile);

  if (!name) {
    return;
  }

  const trip = {
    id: crypto.randomUUID(),
    name,
    slug: createUniqueSlug(name),
    description,
    createdAt: new Date().toISOString(),
    sortOrder: getNextSortOrder(),
    images: [],
  };

  setBusy(true);
  try {
    if (state.mode === "remote") {
      setStatusMessage("Guardando viaje en Supabase...");
      await upsertRemoteTrip(trip);
      if (files.length > 0) {
        await appendImagesToRemoteTrip(trip.id, files, 0);
      }
      state.trips = await loadRemoteTrips();
      setStatusMessage(buildStatusMessage());
    } else {
      const images = await Promise.all(files.map(fileToStoredImage));
      await saveLocalTrip({
        ...trip,
        images,
      });
      state.trips = await getLocalTrips();
      setStatusMessage(buildStatusMessage());
    }
  } finally {
    setBusy(false);
  }

  closeModal();
  location.hash = `#trip/${trip.slug}`;
  render();
}

function handlePreview() {
  const files = [...elements.tripImages.files].filter(isSupportedImageFile);
  elements.previewGrid.innerHTML = "";

  files.slice(0, 8).forEach((file) => {
    if (isHeicFile(file)) {
      const placeholder = document.createElement("div");
      placeholder.className = "preview-grid__heic";
      placeholder.textContent = `${file.name} - HEIC`;
      elements.previewGrid.append(placeholder);
      return;
    }

    const img = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);
    img.alt = file.name;
    img.src = objectUrl;
    img.onload = () => URL.revokeObjectURL(objectUrl);
    img.onerror = () => URL.revokeObjectURL(objectUrl);
    elements.previewGrid.append(img);
  });
}

function render() {
  const routeTrip = getRouteTrip();
  renderTopPreview(state.trips);
  renderEmptyState();
  updateSyncUi();

  if (routeTrip) {
    renderTripView(routeTrip);
    requestAnimationFrame(() => {
      elements.tripView.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else {
    elements.tripView.classList.add("hidden");
  }
}

function renderEmptyState() {
  const showEmpty = state.trips.length === 0;
  elements.emptyState.classList.toggle("hidden", !showEmpty);
}

function renderTopPreview(trips) {
  const previousPositions = capturePreviewPositions();
  elements.topPreviewRail.innerHTML = "";

  if (trips.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "top-preview__hint";
    placeholder.textContent =
      state.remoteAvailable && state.localTripCount > 0
        ? "Tus viajes locales estan listos para subirse a Supabase."
        : "Tus previews apareceran aqui cuando crees un viaje.";
    elements.topPreviewRail.append(placeholder);
    return;
  }

  trips.forEach((trip) => {
    const node = elements.previewCardTemplate.content.cloneNode(true);
    const button = node.querySelector(".preview-card");
    const image = node.querySelector(".preview-card__image");
    const imagePlaceholder = node.querySelector(".preview-card__placeholder");
    const name = node.querySelector(".preview-card__name");

    if (trip.images.length > 0) {
      image.src = getImageSrc(trip.images[0]);
      image.alt = `Preview de ${trip.name}`;
      image.classList.remove("hidden");
      imagePlaceholder.classList.add("hidden");
    } else {
      image.removeAttribute("src");
      image.alt = "";
      image.classList.add("hidden");
      imagePlaceholder.classList.remove("hidden");
    }

    name.textContent = trip.name;
    button.draggable = true;
    button.dataset.tripId = trip.id;
    button.addEventListener("click", () => {
      if (state.suppressPreviewClick) {
        state.suppressPreviewClick = false;
        return;
      }

      openTrip(trip.slug);
    });
    button.addEventListener("dragstart", (event) => handleTripDragStart(event, trip.id));
    button.addEventListener("dragend", handleTripDragEnd);
    button.addEventListener("dragover", (event) => handleTripDragOver(event, trip.id));
    button.addEventListener("drop", (event) => handleTripDrop(event, trip.id));
    elements.topPreviewRail.append(node);
  });

  animatePreviewReorder(previousPositions);
}

function renderTripView(trip) {
  elements.tripView.innerHTML = "";
  const node = elements.galleryTemplate.content.cloneNode(true);
  const backLink = node.querySelector(".back-link");
  const cover = node.querySelector(".gallery__cover");
  const coverPlaceholder = node.querySelector(".gallery__cover-placeholder");
  const title = node.querySelector(".gallery__title");
  const description = node.querySelector(".gallery__description");
  const editButton = node.querySelector(".gallery__edit-button");
  const deleteTripButton = node.querySelector(".gallery__delete-trip");
  const count = node.querySelector(".gallery__count");
  const route = node.querySelector(".gallery__route");
  const grid = node.querySelector(".gallery__grid");
  const empty = node.querySelector(".gallery__empty");
  const fileInput = node.querySelector(".gallery__file-input");
  const copyButton = node.querySelector(".gallery__copy-button");
  const coverSrc = trip.images.length > 0 ? getImageSrc(trip.images[0]) : null;

  if (trip.images.length > 0) {
    cover.src = getImageSrc(trip.images[0]);
    cover.alt = `Portada de ${trip.name}`;
    cover.classList.remove("hidden");
    coverPlaceholder.classList.add("hidden");
    empty.classList.add("hidden");
  } else {
    cover.removeAttribute("src");
    cover.alt = "";
    cover.classList.add("hidden");
    coverPlaceholder.classList.remove("hidden");
    empty.classList.remove("hidden");
  }

  title.textContent = trip.name;
  description.textContent =
    trip.description || "Tu galeria esta lista para abrirse desde cualquier telefono.";
  count.textContent = describeImageCount(trip.images.length);
  route.textContent = `#trip/${trip.slug}`;

  copyButton.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#trip/${trip.slug}`;
    await navigator.clipboard.writeText(url);
    copyButton.textContent = "Enlace copiado";
    setTimeout(() => {
      copyButton.textContent = "Obtener enlace NFC";
    }, 1400);
  });

  editButton.addEventListener("click", async () => {
    if (state.isBusy) {
      return;
    }

    const nextDescription = window.prompt(
      "Edita la descripcion del viaje",
      trip.description || ""
    );

    if (nextDescription === null) {
      return;
    }

    setBusy(true);
    try {
      await updateTripDescription(trip.id, nextDescription.trim());
      await reloadTripsAfterMutation("Descripcion actualizada.");
    } finally {
      setBusy(false);
    }
  });

  deleteTripButton.addEventListener("click", async () => {
    if (state.isBusy) {
      return;
    }

    const confirmed = window.confirm(`Eliminar el viaje "${trip.name}"?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await deleteTrip(trip.id);
      history.pushState("", document.title, window.location.pathname + window.location.search);
      await reloadTripsAfterMutation("Viaje eliminado.");
    } finally {
      setBusy(false);
    }
  });

  trip.images.forEach((imageEntry, index) => {
    const imageData = normalizeStoredImage(imageEntry);
    const item = document.createElement("figure");
    const img = document.createElement("img");
    const deleteButton = document.createElement("button");
    const coverButton = document.createElement("button");

    item.className = "gallery__item";
    if (isHeicImage(imageData)) {
      item.classList.add("gallery__item--heic");
    }

    img.src = imageData.src;
    img.alt = imageData.name || `${trip.name} foto ${index + 1}`;

    deleteButton.className = "gallery__delete";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Eliminar foto ${index + 1}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async () => {
      if (state.isBusy) {
        return;
      }

      setBusy(true);
      try {
        await removeImageFromTrip(trip.id, index);
        await reloadTripsAfterMutation("Imagen eliminada.");
      } finally {
        setBusy(false);
      }
    });

    coverButton.className = "gallery__cover-pick";
    coverButton.type = "button";
    coverButton.textContent = "✨";
    coverButton.setAttribute(
      "aria-label",
      imageData.src === coverSrc ? "Foto usada como portada" : `Usar foto ${index + 1} como portada`
    );
    if (imageData.src === coverSrc) {
      coverButton.classList.add("is-active");
      coverButton.disabled = true;
    } else {
      coverButton.addEventListener("click", async () => {
        if (state.isBusy) {
          return;
        }

        setBusy(true);
        try {
          await setTripCover(trip.id, index);
          await reloadTripsAfterMutation("Portada actualizada.");
        } finally {
          setBusy(false);
        }
      });
    }

    item.append(img, coverButton, deleteButton);
    grid.append(item);
  });

  fileInput.addEventListener("change", async (event) => {
    const files = [...event.target.files].filter(isSupportedImageFile);
    if (files.length === 0 || state.isBusy) {
      return;
    }

    setBusy(true);
    try {
      await appendImagesToTrip(trip.id, files);
      await reloadTripsAfterMutation("Fotos subidas.");
    } finally {
      setBusy(false);
      fileInput.value = "";
    }
  });

  backLink.addEventListener("click", () => {
    history.pushState("", document.title, window.location.pathname + window.location.search);
    render();
  });

  elements.tripView.append(node);
  elements.tripView.classList.remove("hidden");
}

function openTrip(slug) {
  location.hash = `#trip/${slug}`;
}

function getRouteTrip() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash.startsWith("trip/")) {
    return null;
  }

  const slug = hash.replace("trip/", "");
  return state.trips.find((trip) => trip.slug === slug) || null;
}

function createUniqueSlug(name) {
  const baseSlug = slugify(name);
  const existing = new Set(state.trips.map((trip) => trip.slug));

  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let index = 2;
  while (existing.has(`${baseSlug}-${index}`)) {
    index += 1;
  }

  return `${baseSlug}-${index}`;
}

function getNextSortOrder() {
  if (state.trips.length === 0) {
    return 1;
  }

  return Math.max(...state.trips.map((trip) => trip.sortOrder || 0)) + 1;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function describeImageCount(imageCount) {
  const suffix = state.mode === "remote" ? "en Supabase" : "localmente";
  if (imageCount === 1) {
    return `1 recuerdo guardado ${suffix}`;
  }

  return `${imageCount} recuerdos guardados ${suffix}`;
}

function setStatusMessage(message) {
  state.statusMessage = message;
  elements.syncStatus.textContent = message;
}

function buildStatusMessage() {
  if (state.mode === "remote") {
    if (state.localTripCount > 0 && !window.localStorage.getItem(MIGRATION_MARKER_KEY)) {
      return "Supabase conectado. Tus viajes actuales de este Mac se pueden subir para usarlos tambien en el telefono.";
    }

    return "Supabase conectado. Lo que subas aqui quedara disponible tambien en tu telefono.";
  }

  if (state.remoteErrorMessage) {
    return `Modo local activo. Supabase ha fallado: ${state.remoteErrorMessage}`;
  }

  return "Modo local activo. Tus cambios siguen guardandose solo en este navegador.";
}

function updateSyncUi() {
  const showRemoteActions = state.remoteAvailable;
  const showMigrationButton =
    state.remoteAvailable &&
    state.localTripCount > 0 &&
    !window.localStorage.getItem(MIGRATION_MARKER_KEY);

  elements.refreshTrips.classList.toggle("hidden", !showRemoteActions);
  elements.migrateLocalData.classList.toggle("hidden", !showMigrationButton);
  elements.migrateLocalData.disabled = state.isBusy;
  elements.refreshTrips.disabled = state.isBusy;
  elements.openCreateModal.disabled = state.isBusy;
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  updateSyncUi();
}

async function reloadTripsAfterMutation(statusMessage) {
  state.trips = state.mode === "remote" ? await loadRemoteTrips() : await getLocalTrips();
  setStatusMessage(statusMessage || buildStatusMessage());
  render();
}

async function refreshRemoteTrips(statusMessage) {
  state.trips = await loadRemoteTrips();
  setStatusMessage(statusMessage || buildStatusMessage());
  render();
}

async function tryLoadRemoteTrips() {
  try {
    state.remoteErrorMessage = "";
    return await loadRemoteTrips();
  } catch (error) {
    console.error("Supabase no disponible:", error);
    state.remoteErrorMessage = error?.message || "Error desconocido de Supabase.";
    return null;
  }
}

async function loadRemoteTrips() {
  const [{ data: tripRows, error: tripsError }, { data: imageRows, error: imagesError }] =
    await Promise.all([
      supabase
        .from("trips")
        .select("id, slug, name, description, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("trip_images")
        .select("id, trip_id, storage_path, public_url, position, name, mime_type, created_at")
        .order("position", { ascending: true }),
    ]);

  if (tripsError) {
    throw tripsError;
  }

  if (imagesError) {
    throw imagesError;
  }

  const imagesByTripId = new Map();
  for (const image of imageRows || []) {
    const list = imagesByTripId.get(image.trip_id) || [];
    list.push(image);
    imagesByTripId.set(image.trip_id, list);
  }

  return (tripRows || []).map((trip) => ({
    id: trip.id,
    slug: trip.slug,
    name: trip.name,
    description: trip.description || "",
    createdAt: trip.created_at,
    sortOrder: trip.sort_order || 0,
    images: (imagesByTripId.get(trip.id) || [])
      .sort((a, b) => a.position - b.position)
      .map((image) => ({
        id: image.id,
        src: image.public_url,
        name: image.name,
        type: image.mime_type,
        storagePath: image.storage_path,
      })),
  }));
}

async function migrateLocalTripsToSupabase(localTrips, automatic) {
  if (!state.remoteAvailable || localTrips.length === 0 || state.isBusy) {
    return;
  }

  setBusy(true);
  try {
    setStatusMessage(
      automatic
        ? "Subiendo automaticamente tus viajes actuales a Supabase..."
        : "Subiendo tus viajes actuales a Supabase..."
    );

    const remoteTrips = await loadRemoteTrips();
    const remoteById = new Map(remoteTrips.map((trip) => [trip.id, trip]));

    for (const localTrip of localTrips) {
      await upsertRemoteTrip(localTrip);

      const remoteTrip = remoteById.get(localTrip.id);
      const remoteImageCount = remoteTrip ? remoteTrip.images.length : 0;

      if (remoteImageCount >= localTrip.images.length) {
        continue;
      }

      const remainingImages = localTrip.images.slice(remoteImageCount);
      await appendImagesToRemoteTrip(localTrip.id, remainingImages, remoteImageCount);
    }

    window.localStorage.setItem(MIGRATION_MARKER_KEY, "done");
    state.trips = await loadRemoteTrips();
    setStatusMessage("Migracion completada. Tus viajes ya estan en Supabase.");
    render();
  } finally {
    setBusy(false);
  }
}

async function upsertRemoteTrip(trip) {
  const payload = {
    id: trip.id,
    slug: trip.slug,
    name: trip.name,
    description: trip.description || "",
    sort_order: trip.sortOrder || 0,
    created_at: trip.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("trips").upsert(payload, {
    onConflict: "id",
  });

  if (error) {
    throw error;
  }
}

async function appendImagesToTrip(tripId, files) {
  if (state.mode === "remote") {
    const trip = state.trips.find((entry) => entry.id === tripId);
    const startPosition = trip ? trip.images.length : 0;
    await appendImagesToRemoteTrip(tripId, files, startPosition);
    return;
  }

  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip) {
    return;
  }

  const newImages = await Promise.all(files.map(fileToStoredImage));
  await saveLocalTrip({
    ...trip,
    images: [...trip.images, ...newImages],
  });
}

async function appendImagesToRemoteTrip(tripId, imageSources, startPosition) {
  for (let index = 0; index < imageSources.length; index += 1) {
    await uploadRemoteImage(tripId, imageSources[index], startPosition + index);
  }
}

async function uploadRemoteImage(tripId, imageSource, position) {
  const asset = await normalizeUploadAsset(imageSource);
  const extension = getFileExtension(asset.name, asset.type);
  const fileId = crypto.randomUUID();
  const storagePath = `${tripId}/${String(position).padStart(3, "0")}-${fileId}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, asset.blob, {
    contentType: asset.type,
    upsert: false,
  });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const { error: insertError } = await supabase.from("trip_images").insert({
    id: crypto.randomUUID(),
    trip_id: tripId,
    storage_path: storagePath,
    public_url: publicUrlData.publicUrl,
    position,
    name: asset.name,
    mime_type: asset.type,
  });

  if (insertError) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw insertError;
  }
}

async function normalizeUploadAsset(source) {
  if (source instanceof File || source instanceof Blob) {
    const sourceName = source instanceof File ? source.name : "imagen.jpg";
    if (source instanceof File && isHeicFile(source)) {
      const converted = await convertHeicBlob(source, source.name);
      return storedImageToUploadAsset(converted);
    }

    return {
      blob: source,
      name: sourceName,
      type: source.type || guessMimeTypeFromName(sourceName),
    };
  }

  return storedImageToUploadAsset(normalizeStoredImage(source));
}

async function storedImageToUploadAsset(image) {
  const response = await fetch(image.src);
  const blob = await response.blob();

  return {
    blob,
    name: image.name || `imagen.${getFileExtension(image.name, image.type)}`,
    type: image.type || "image/jpeg",
  };
}

function getFileExtension(name, mimeType) {
  const explicitExtension = name?.split(".").pop();
  if (explicitExtension && explicitExtension !== name) {
    return explicitExtension.toLowerCase();
  }

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function handleTripDragStart(event, tripId) {
  state.draggedTripId = tripId;
  state.dragStartOrder = state.trips.map((trip) => trip.id);
  state.lastPreviewSwap = "";
  state.suppressPreviewClick = false;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tripId);
  event.currentTarget.classList.add("is-dragging");
}

async function handleTripDragEnd(event) {
  const hadVisualReorder =
    state.dragStartOrder &&
    state.trips.length === state.dragStartOrder.length &&
    state.trips.some((trip, index) => trip.id !== state.dragStartOrder[index]);

  if (hadVisualReorder) {
    setBusy(true);
    try {
      await persistTripOrder();
      state.trips = state.mode === "remote" ? await loadRemoteTrips() : await getLocalTrips();
      state.suppressPreviewClick = true;
      setStatusMessage("Orden actualizado.");
      render();
    } finally {
      setBusy(false);
    }
  } else if (state.dragStartOrder) {
    state.trips = reorderTripsByIdList(state.dragStartOrder);
    renderTopPreview(state.trips);
  }

  state.draggedTripId = null;
  state.dragStartOrder = null;
  state.lastPreviewSwap = "";
  event.currentTarget.classList.remove("is-dragging");
}

function handleTripDragOver(event, targetTripId) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  if (!state.draggedTripId || state.draggedTripId === targetTripId) {
    return;
  }

  const swapKey = `${state.draggedTripId}->${targetTripId}`;
  if (state.lastPreviewSwap === swapKey) {
    return;
  }

  const cards = [...elements.topPreviewRail.querySelectorAll(".preview-card")];
  const draggedCard = cards.find((card) => card.dataset.tripId === state.draggedTripId);
  const targetCard = cards.find((card) => card.dataset.tripId === targetTripId);

  if (!draggedCard || !targetCard || draggedCard === targetCard) {
    return;
  }

  const previousPositions = capturePreviewPositions();
  const draggedIndex = cards.indexOf(draggedCard);
  const targetIndex = cards.indexOf(targetCard);

  if (draggedIndex < targetIndex) {
    elements.topPreviewRail.insertBefore(draggedCard, targetCard.nextSibling);
  } else {
    elements.topPreviewRail.insertBefore(draggedCard, targetCard);
  }

  state.trips = reorderTripsInState(state.draggedTripId, targetTripId);
  state.lastPreviewSwap = swapKey;
  animatePreviewReorder(previousPositions);
}

function handleTripDrop(event, targetTripId) {
  event.preventDefault();
  state.lastPreviewSwap = `${state.draggedTripId || ""}->${targetTripId}`;
}

async function persistTripOrder() {
  const updatedTrips = state.trips.map((trip, index) => ({
    ...trip,
    sortOrder: index + 1,
  }));

  state.trips = updatedTrips;

  if (state.mode === "remote") {
    await Promise.all(
      updatedTrips.map((trip) =>
        supabase
          .from("trips")
          .update({ sort_order: trip.sortOrder, updated_at: new Date().toISOString() })
          .eq("id", trip.id)
      )
    );
    return;
  }

  await Promise.all(updatedTrips.map((trip) => saveLocalTrip(trip)));
}

function reorderTripsByIdList(idList) {
  const byId = new Map(state.trips.map((trip) => [trip.id, trip]));
  return idList.map((id) => byId.get(id)).filter(Boolean);
}

function reorderTripsInState(sourceTripId, targetTripId) {
  const trips = [...state.trips];
  const sourceIndex = trips.findIndex((trip) => trip.id === sourceTripId);
  const targetIndex = trips.findIndex((trip) => trip.id === targetTripId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return trips;
  }

  const [movedTrip] = trips.splice(sourceIndex, 1);
  trips.splice(targetIndex, 0, movedTrip);
  return trips;
}

function capturePreviewPositions() {
  const positions = new Map();
  elements.topPreviewRail.querySelectorAll(".preview-card").forEach((card) => {
    positions.set(card.dataset.tripId, card.getBoundingClientRect());
  });
  return positions;
}

function animatePreviewReorder(previousPositions) {
  if (previousPositions.size === 0) {
    return;
  }

  elements.topPreviewRail.querySelectorAll(".preview-card").forEach((card) => {
    const previous = previousPositions.get(card.dataset.tripId);
    if (!previous) {
      return;
    }

    const next = card.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    card.style.transition = "none";
    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    card.style.willChange = "transform";

    requestAnimationFrame(() => {
      card.style.transition = "transform 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease";
      card.style.transform = "";
      const cleanup = () => {
        card.style.willChange = "";
        card.removeEventListener("transitionend", cleanup);
      };
      card.addEventListener("transitionend", cleanup);
    });
  });
}

async function removeImageFromTrip(tripId, imageIndex) {
  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip) {
    return;
  }

  if (state.mode === "remote") {
    const image = trip.images[imageIndex];
    if (!image) {
      return;
    }

    if (image.storagePath) {
      await supabase.storage.from(STORAGE_BUCKET).remove([image.storagePath]);
    }

    await supabase.from("trip_images").delete().eq("id", image.id);

    const nextImages = trip.images.filter((_, index) => index !== imageIndex);
    await updateRemoteImagePositions(nextImages);
    return;
  }

  await saveLocalTrip({
    ...trip,
    images: trip.images.filter((_, index) => index !== imageIndex),
  });
}

async function setTripCover(tripId, imageIndex) {
  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip || imageIndex < 0 || imageIndex >= trip.images.length) {
    return;
  }

  const nextImages = [...trip.images];
  const [coverImage] = nextImages.splice(imageIndex, 1);
  nextImages.unshift(coverImage);

  if (state.mode === "remote") {
    await updateRemoteImagePositions(nextImages);
    return;
  }

  await saveLocalTrip({
    ...trip,
    images: nextImages,
  });
}

async function updateRemoteImagePositions(images) {
  const temporaryOffset = images.length + 1000;

  await Promise.all(
    images.map((image, index) =>
      supabase.from("trip_images").update({ position: temporaryOffset + index }).eq("id", image.id)
    )
  );

  await Promise.all(
    images.map((image, index) => supabase.from("trip_images").update({ position: index }).eq("id", image.id))
  );
}

async function updateTripDescription(tripId, description) {
  const trip = state.trips.find((entry) => entry.id === tripId);
  if (!trip) {
    return;
  }

  if (state.mode === "remote") {
    const { error } = await supabase
      .from("trips")
      .update({ description, updated_at: new Date().toISOString() })
      .eq("id", tripId);

    if (error) {
      throw error;
    }
    return;
  }

  await saveLocalTrip({
    ...trip,
    description,
  });
}

async function deleteTrip(tripId) {
  if (state.mode === "remote") {
    const trip = state.trips.find((entry) => entry.id === tripId);
    if (trip?.images?.length) {
      const paths = trip.images.map((image) => image.storagePath).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      }
    }

    const { error } = await supabase.from("trips").delete().eq("id", tripId);
    if (error) {
      throw error;
    }
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(tripId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function isSupportedImageFile(file) {
  return file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
}

function isHeicFile(file) {
  return /image\/hei(c|f)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function guessMimeTypeFromName(name) {
  if (/\.heic$/i.test(name)) {
    return "image/heic";
  }

  if (/\.heif$/i.test(name)) {
    return "image/heif";
  }

  if (/\.png$/i.test(name)) {
    return "image/png";
  }

  if (/\.webp$/i.test(name)) {
    return "image/webp";
  }

  return "image/jpeg";
}

function normalizeStoredImage(image) {
  if (typeof image === "string") {
    return {
      src: image,
      name: "",
      type: /^data:image\/hei(c|f)/i.test(image) ? image.slice(5, image.indexOf(";")) : "image/jpeg",
    };
  }

  return image;
}

function getImageSrc(image) {
  return normalizeStoredImage(image).src;
}

function isHeicImage(image) {
  const normalized = normalizeStoredImage(image);
  return /image\/hei(c|f)/i.test(normalized.type) || /^data:image\/hei(c|f)/i.test(normalized.src);
}

async function fileToStoredImage(file) {
  if (isHeicFile(file)) {
    return convertHeicBlob(file, file.name);
  }

  return fileToDataUrl(file);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        src: reader.result,
        name: file.name,
        type: file.type || guessMimeTypeFromName(file.name),
      });
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function convertHeicBlob(blob, fileName) {
  const response = await fetch("/api/convert-heic", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(fileName),
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error("No se pudo convertir la imagen HEIC localmente.");
  }

  return response.json();
}

async function migrateStoredHeicImages(trips) {
  let changed = false;
  const migratedTrips = [];

  for (const trip of trips) {
    let tripChanged = false;
    const migratedImages = [];

    for (const image of trip.images) {
      if (!isHeicImage(image)) {
        migratedImages.push(image);
        continue;
      }

      const normalized = normalizeStoredImage(image);
      const blob = await fetch(normalized.src).then((response) => response.blob());
      const converted = await convertHeicBlob(blob, normalized.name || "imagen.heic");
      migratedImages.push(converted);
      tripChanged = true;
      changed = true;
    }

    if (tripChanged) {
      const updatedTrip = { ...trip, images: migratedImages };
      await saveLocalTrip(updatedTrip);
      migratedTrips.push(updatedTrip);
    } else {
      migratedTrips.push(trip);
    }
  }

  return changed ? migratedTrips : trips;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveLocalTrip(trip) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(trip);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function getLocalTrips() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const trips = request.result
        .map((trip) => ({
          ...trip,
          sortOrder: trip.sortOrder || 0,
        }))
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          }

          return b.createdAt.localeCompare(a.createdAt);
        });
      resolve(trips);
    };
    request.onerror = () => reject(request.error);
  });
}
