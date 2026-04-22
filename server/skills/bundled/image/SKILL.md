# image — Generate, show, and analyze images

Three related capabilities under the image group:

- `image_generate` produces an image from a text prompt and saves it to the workspace. Describe subject, style, composition, lighting, and aspect ratio — vague prompts produce vague images. Share the saved path with the user after generating.
- `show_image` displays an existing image (workspace path or URL) in the chat. Use this to surface something the user already has, without generating a new file.
- `image_analyze` reads an image's contents. Call it before answering any question that refers to an attached or referenced image.
