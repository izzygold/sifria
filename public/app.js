const app = document.querySelector("#app");
const profile = document.querySelector("#profile");
const readCount = document.querySelector("#read-count");
const search = document.querySelector("#q");
const tabs = [...document.querySelectorAll("#library .view-btn")];
const gate = document.querySelector("#gate");
const library = document.querySelector("#library");
const authForm = document.querySelector("#auth-form");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const authError = document.querySelector("#auth-error");
const userList = document.querySelector("#user-list");
const legacyNote = document.querySelector("#legacy-note");
const who = document.querySelector("#who");
const layoutButton = document.querySelector("#layout");
const layoutMode = document.querySelector("#layout-mode");

const ui = {
  view: "home",
  query: "",
  busy: false,
  token: 0,
  layout: localStorage.getItem("sifria-layout") === "thumbs" ? "thumbs" : "list",
};

function applyLayout() {
  const thumbs = ui.layout === "thumbs";
  library.classList.toggle("thumbs", thumbs);
  layoutMode.textContent = thumbs ? "תמונות" : "תצוגה ראשונה";
  layoutButton.classList.toggle("is-on", thumbs);
  layoutButton.setAttribute("aria-pressed", thumbs ? "true" : "false");
}

applyLayout();

layoutButton.addEventListener("click", () => {
  ui.layout = ui.layout === "thumbs" ? "list" : "thumbs";
  localStorage.setItem("sifria-layout", ui.layout);
  applyLayout();
});

tabs.forEach((button) => {
  button.addEventListener("click", () => {
    ui.view = button.dataset.view;
    tabs.forEach((item) => item.classList.toggle("is-on", item === button));
    load();
  });
});

let timer = 0;
search.addEventListener("input", () => {
  ui.query = search.value;
  if (ui.query.trim() && ui.view !== "home") {
    ui.view = "home";
    tabs.forEach((item) => item.classList.toggle("is-on", item.dataset.view === "home"));
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 220);
});

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function openCover(book) {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  const close = text("button", "lightbox-close", "סגירה");
  close.type = "button";
  const caption = text("p", "lightbox-caption", book.name);
  const shut = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") shut();
  };
  close.addEventListener("click", shut);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) shut();
  });
  if (book.image) {
    const img = document.createElement("img");
    img.alt = book.name;
    img.src = book.image;
    img.addEventListener("error", () => {
      img.replaceWith(text("p", "lightbox-missing", "אין תמונה לספר הזה"));
    });
    overlay.append(close, img, caption);
  } else {
    overlay.append(close, text("p", "lightbox-missing", "אין תמונה לספר הזה"), caption);
  }
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  close.focus();
}

function bookCard(book) {
  const card = document.createElement("article");
  card.className = "book";

  const cover = document.createElement("button");
  cover.type = "button";
  cover.className = "cover";
  cover.setAttribute("aria-label", `פתיחת התמונה של ${book.name}`);
  cover.append(text("span", "", (book.name || "?").trim().charAt(0)));
  if (book.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = book.image;
    img.addEventListener("error", () => img.remove());
    cover.append(img);
  }
  cover.addEventListener("click", () => openCover(book));

  const body = document.createElement("div");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "book-title";
  title.textContent = book.name;
  title.addEventListener("click", () => openCover(book));
  const heading = document.createElement("h3");
  heading.append(title);
  body.append(heading);
  const bits = [book.author || "מחבר לא צוין", book.language, book.audience, book.pages].filter(Boolean);
  body.append(text("p", "meta", bits.join(" · ")));
  if (book.reason) body.append(text("p", "reason", book.reason));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    actionButton("like", "לייק", book.liked, book.id),
    actionButton("dislike", "דיסלייק", book.disliked, book.id),
    actionButton("borrow", book.borrowed ? "להחזיר לספריה" : "לקחתי מהספריה", book.borrowed, book.id),
    actionButton("wait", "מחכה לספריה", book.waiting, book.id),
  );
  body.append(actions);
  card.append(cover, body);
  return card;
}

function actionButton(action, label, on, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `act ${action}${on ? " is-on" : ""}`;
  button.textContent = label;
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.disabled = ui.busy;
  button.addEventListener("click", () => act(id, action));
  return button;
}

function section(title, hint, books) {
  const block = document.createElement("section");
  block.className = "section";
  block.append(text("h2", "", title));
  if (!books.length) {
    block.append(text("div", "empty", hint || "אין כאן ספרים"));
    return block;
  }
  if (hint) block.append(text("p", "hint", hint));
  const list = document.createElement("div");
  list.className = "list";
  books.forEach((book) => list.append(bookCard(book)));
  block.append(list);
  return block;
}

function renderHome(data) {
  app.replaceChildren();
  if (ui.query.trim().length >= 2) {
    app.append(
      section(
        "תוצאות חיפוש",
        data.search.length ? "אפשר לסמן לייק, דיסלייק, או לקחת הביתה." : "לא נמצאו ספרים לחיפוש הזה.",
        data.search,
      ),
    );
  }
  app.append(
    section(
      "אצלי עכשיו",
      data.borrowed.length
        ? "הספרים שלקחתם מהספרייה ועודם אצלכם."
        : "עדיין אין אצלכם ספרים. חפשו ספר ולחצו «לקחתי מהספריה».",
      data.borrowed,
    ),
  );
  app.append(
    section(
      "מחכה לספריה",
      data.waiting.length
        ? "ספרים שסימנתם ומחכים שתקחו אותם מהספרייה."
        : "עוד אין ספרים שמחכים. לחצו «מחכה לספריה» על ספר.",
      data.waiting,
    ),
  );
  app.append(
    section(
      "מומלץ לקרוא",
      data.recommended.length
        ? data.profile.note
        : "סמנו לייק על ספר שאהבתם, וכאן יופיעו הספרים הבאים בסדרה ועוד ספרים שמתאימים לכם.",
      data.recommended,
    ),
  );
  app.append(text("p", "foot", `${data.totals.books.toLocaleString("he-IL")} ספרים בקטלוג · ${data.totals.series.toLocaleString("he-IL")} סדרות שזיהינו`));
}

function renderRead(data) {
  app.replaceChildren();
  app.append(
    section(
      "אהבתי",
      data.liked.length ? "ספרים שסימנתם בלייק." : "עוד אין ספרים עם לייק. לייק מסמן שקראתם ואהבתם.",
      data.liked,
    ),
  );
  app.append(
    section(
      "לא התחברתי",
      data.disliked.length ? "ספרים שסימנתם בדיסלייק. לא נציע עוד ספרים של אותו מחבר, אלא אם אהבתם ספר אחר שלו." : "דיסלייק מסמן שקראתם ולא התחברתם.",
      data.disliked,
    ),
  );
}

function paintProfile(data) {
  const profileText = `קראתם ${data.profile.readCount} · אהבתם ${data.profile.likeCount} · לא התחברתם ${data.profile.dislikeCount} · אצלכם ${data.profile.borrowedCount} · מחכים ${data.profile.waitingCount}`;
  profile.textContent = profileText;
  readCount.textContent = data.profile.readCount
    ? data.profile.readCount === 1
      ? "ספר אחד"
      : `${data.profile.readCount} ספרים`
    : "לייק ודיסלייק";
}

function showGate() {
  gate.hidden = false;
  library.hidden = true;
  refreshUsers();
}

function showLibrary(username) {
  gate.hidden = true;
  library.hidden = false;
  who.textContent = `שלום, ${username}`;
}

async function refreshUsers() {
  const response = await fetch("/api/users");
  const data = await response.json();
  legacyNote.hidden = !data.legacyWaiting;
  userList.replaceChildren();
  data.users.forEach((user) => {
    const button = text("button", "user-chip", user.username);
    button.type = "button";
    button.addEventListener("click", () => {
      usernameInput.value = user.username;
      passwordInput.focus();
      userList.querySelectorAll(".user-chip").forEach((chip) => {
        chip.classList.toggle("is-on", chip === button);
      });
    });
    userList.append(button);
  });
}

async function enter(path) {
  authError.textContent = "";
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: usernameInput.value,
      password: passwordInput.value,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    authError.textContent = data.error || "לא הצלחנו להיכנס";
    return;
  }
  passwordInput.value = "";
  showLibrary(data.username);
  await load();
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enter("/api/login");
});

document.querySelector("#register").addEventListener("click", () => {
  enter("/api/register");
});

document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  ui.view = "home";
  ui.query = "";
  search.value = "";
  tabs.forEach((item) => item.classList.toggle("is-on", item.dataset.view === "home"));
  showGate();
});

async function load() {
  const token = ++ui.token;
  const query = ui.view === "home" ? `?q=${encodeURIComponent(ui.query.trim())}` : "";
  const url = ui.view === "read" ? "/api/read" : `/api/home${query}`;
  const response = await fetch(url);
  if (response.status === 401) {
    showGate();
    return;
  }
  if (!response.ok || token !== ui.token) return;
  const data = await response.json();
  if (token !== ui.token) return;
  showLibrary(data.username);
  paintProfile(data);
  if (ui.view === "read") renderRead(data);
  else renderHome(data);
}

async function act(id, action) {
  if (ui.busy) return;
  ui.busy = true;
  app.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  await fetch(`/api/books/${id}/${action}`, { method: "POST" });
  ui.busy = false;
  await load();
}

fetch("/api/me").then(async (response) => {
  if (!response.ok) {
    showGate();
    return;
  }
  const data = await response.json();
  showLibrary(data.username);
  load();
});
