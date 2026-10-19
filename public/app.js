const app = document.querySelector("#app");
const profile = document.querySelector("#profile");
const readCount = document.querySelector("#read-count");
const search = document.querySelector("#q");
const tabs = [...document.querySelectorAll(".view-btn")];

const ui = {
  view: "home",
  query: "",
  busy: false,
  token: 0,
};

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

function bookCard(book) {
  const card = document.createElement("article");
  card.className = "book";

  const cover = document.createElement("div");
  cover.className = "cover";
  cover.append(text("span", "", (book.name || "?").trim().charAt(0)));
  if (book.image) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = book.image;
    img.addEventListener("error", () => img.remove());
    cover.append(img);
  }

  const body = document.createElement("div");
  body.append(text("h3", "", book.name));
  const bits = [book.author || "מחבר לא צוין", book.language, book.audience, book.pages].filter(Boolean);
  body.append(text("p", "meta", bits.join(" · ")));
  if (book.reason) body.append(text("p", "reason", book.reason));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    actionButton("like", "לייק", book.liked, book.id),
    actionButton("dislike", "דיסלייק", book.disliked, book.id),
    actionButton("borrow", book.borrowed ? "להחזיר לספריה" : "לקחתי מהספריה", book.borrowed, book.id),
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
  const profileText = `קראתם ${data.profile.readCount} · אהבתם ${data.profile.likeCount} · לא התחברתם ${data.profile.dislikeCount} · אצלכם ${data.profile.borrowedCount}`;
  profile.textContent = profileText;
  readCount.textContent = data.profile.readCount
    ? data.profile.readCount === 1
      ? "ספר אחד"
      : `${data.profile.readCount} ספרים`
    : "לייק ודיסלייק";
}

async function load() {
  const token = ++ui.token;
  const query = ui.view === "home" ? `?q=${encodeURIComponent(ui.query.trim())}` : "";
  const url = ui.view === "read" ? "/api/read" : `/api/home${query}`;
  const response = await fetch(url);
  if (!response.ok || token !== ui.token) return;
  const data = await response.json();
  if (token !== ui.token) return;
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

load();
