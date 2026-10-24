-- redesign-account-profile (design D4; spec user-access, «Avatar propio» y «Avatar privado del
-- usuario»): el avatar propio de cada usuario, una fila como máximo, que se borra con la identidad.
-- CreateTable
CREATE TABLE "user_avatar" (
    "user_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_avatar_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PNG o JPEG reconocidos por el contenido, hasta 2 MB (el máximo configurable), y la huella del
-- contenido guardado. La validación completa es la de la aplicación; esto es la última defensa.
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_values_check" CHECK (
  "mime_type" IN ('image/png', 'image/jpeg')
  AND "size_bytes" > 0
  AND "size_bytes" <= 2097152
  AND "size_bytes" = octet_length("content")
  AND "sha256" ~ '^[0-9a-f]{64}$'
);
