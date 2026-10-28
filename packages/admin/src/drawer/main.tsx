// The drawer page's entry (/drawer, inside the SDK's iframe). Its look is
// the admin UI's neutral one; dark mode follows the system.

import { render } from "preact";
import { Drawer } from "./Drawer.tsx";
import "../styles.css";
import "./drawer.css";

const root = document.getElementById("drawer");
if (root !== null) {
  root.textContent = "";
  render(<Drawer />, root);
}
