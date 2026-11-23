import { Controller, Get } from "@nestjs/common";

import document from "../../openapi.generated.json" with { type: "json" };

@Controller("api")
export class LocalOpenApiController {
  @Get("docs") docs() {
    return document;
  }
  @Get("openapi.json") openapi() {
    return document;
  }
}
